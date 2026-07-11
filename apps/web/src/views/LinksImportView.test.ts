/**
 * Component test for LinksImportView (04-UI-SPEC.md CSV-Bulk-Import-Screen,
 * LINK-08, D-05, UI-06). Mocks `../api`; the CSV is fed directly through
 * the component's internal FileReader flow is bypassed here by driving
 * the file `<input change>` handler with a real `File`, which jsdom's
 * `FileReader` fully supports.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { DomainDTO, ImportCommitResult, ImportPreviewResult } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import LinksImportView from "./LinksImportView.vue";

const { commitImport, listDomains, previewImport } = vi.hoisted(() => ({
  commitImport: vi.fn(),
  listDomains: vi.fn(),
  previewImport: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, commitImport, listDomains, previewImport };
});

function makeDomain(overrides: Partial<DomainDTO> = {}): DomainDTO {
  return {
    id: "d1",
    hostname: "s.meinefirma.de",
    type: "subdomain",
    status: "active",
    verifiedAt: "2026-07-11T00:00:00.000Z",
    lastCheckedAt: null,
    lastCheckError: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/links", name: "links", component: { template: "<div>links</div>" } },
      { path: "/links/import", name: "links-import", component: LinksImportView },
    ],
  });
}

beforeEach(() => {
  commitImport.mockReset();
  listDomains.mockReset();
  previewImport.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountImportView() {
  const router = makeRouter();
  await router.push("/links/import");
  await router.isReady();
  const wrapper = mount(LinksImportView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

async function selectCsvFile(wrapper: Awaited<ReturnType<typeof mountImportView>>["wrapper"]) {
  const file = new File(["ziel_url,slug,domain\nhttps://example.com/a,a,\n"], "links.csv", {
    type: "text/csv",
  });
  const input = wrapper.find("input[type='file']");
  Object.defineProperty(input.element, "files", { value: [file], configurable: true });
  await input.trigger("change");
  // FileReader's onload fires asynchronously — wait it out.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flushPromises();
}

describe("LinksImportView", () => {
  it("selecting a CSV file calls previewImport and renders the valid/skipped summary + a skip reason", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    const result: ImportPreviewResult = {
      validCount: 1,
      skippedCount: 1,
      rows: [
        { zielUrl: "https://example.com/a", slug: "a", domain: null, valid: true, reason: null },
        {
          zielUrl: "https://bad",
          slug: "b",
          domain: null,
          valid: false,
          reason: "invalid_url",
        },
      ],
    };
    previewImport.mockResolvedValue(result);

    const { wrapper } = await mountImportView();
    await selectCsvFile(wrapper);

    expect(previewImport).toHaveBeenCalled();
    expect(wrapper.find(".preview-summary").text()).toContain("1 gültig");
    expect(wrapper.find(".preview-summary").text()).toContain("1 übersprungen");
    expect(wrapper.text()).toContain("Ungültige Ziel-URL");
  });

  it("the Importieren button is disabled when validCount is 0 and enabled otherwise", async () => {
    listDomains.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce({
      validCount: 0,
      skippedCount: 1,
      rows: [{ zielUrl: null, slug: "x", domain: null, valid: false, reason: "invalid_url" }],
    } satisfies ImportPreviewResult);

    const { wrapper } = await mountImportView();
    await selectCsvFile(wrapper);

    const importButton = wrapper.find(".btn-primary");
    expect(importButton.attributes("disabled")).toBeDefined();

    previewImport.mockResolvedValueOnce({
      validCount: 1,
      skippedCount: 0,
      rows: [{ zielUrl: "https://example.com/a", slug: "a", domain: null, valid: true, reason: null }],
    } satisfies ImportPreviewResult);
    await selectCsvFile(wrapper);

    expect(wrapper.find(".btn-primary").attributes("disabled")).toBeUndefined();
  });

  it("clicking Importieren calls commitImport and toasts '{N} Links importiert'", async () => {
    listDomains.mockResolvedValue([]);
    previewImport.mockResolvedValue({
      validCount: 1,
      skippedCount: 0,
      rows: [{ zielUrl: "https://example.com/a", slug: "a", domain: null, valid: true, reason: null }],
    } satisfies ImportPreviewResult);
    commitImport.mockResolvedValue({
      importedCount: 1,
      skippedCount: 0,
      rows: [],
    } satisfies ImportCommitResult);

    const { wrapper } = await mountImportView();
    await selectCsvFile(wrapper);

    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(commitImport).toHaveBeenCalled();
    expect(wrapper.find(".toast").text()).toBe("1 Links importiert");
  });

  it("WR-10: a partial commit result shows a distinct 'aborted, please check' toast", async () => {
    listDomains.mockResolvedValue([]);
    previewImport.mockResolvedValue({
      validCount: 1,
      skippedCount: 0,
      rows: [{ zielUrl: "https://example.com/a", slug: "a", domain: null, valid: true, reason: null }],
    } satisfies ImportPreviewResult);
    commitImport.mockResolvedValue({
      importedCount: 1,
      skippedCount: 0,
      rows: [],
      partial: true,
    } satisfies ImportCommitResult);

    const { wrapper } = await mountImportView();
    await selectCsvFile(wrapper);

    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(commitImport).toHaveBeenCalled();
    expect(wrapper.find(".toast").text()).toContain("1 Links importiert");
    expect(wrapper.find(".toast").text()).toContain("vorzeitig abgebrochen");
  });

  it("renders no client-side re-validation — the preview reflects only the backend result", async () => {
    listDomains.mockResolvedValue([]);
    previewImport.mockResolvedValue({
      validCount: 2,
      skippedCount: 0,
      rows: [
        { zielUrl: "https://example.com/a", slug: "a", domain: null, valid: true, reason: null },
        { zielUrl: "https://example.com/b", slug: "b", domain: null, valid: true, reason: null },
      ],
    } satisfies ImportPreviewResult);

    const { wrapper } = await mountImportView();
    await selectCsvFile(wrapper);

    const rows = wrapper.findAll(".preview-row");
    expect(rows).toHaveLength(2);
    expect(wrapper.find(".valid-count").text()).toBe("2 gültig");
  });

  it("'Beispieldatei laden' loads a demo CSV into the preview without a file picker", async () => {
    listDomains.mockResolvedValue([]);
    previewImport.mockResolvedValue({
      validCount: 2,
      skippedCount: 0,
      rows: [
        { zielUrl: "https://example.com/willkommen", slug: "willkommen", domain: null, valid: true, reason: null },
        { zielUrl: "https://example.com/hilfe", slug: "hilfe", domain: null, valid: true, reason: null },
      ],
    } satisfies ImportPreviewResult);

    const { wrapper } = await mountImportView();

    await wrapper.find(".sample-link").trigger("click");
    await flushPromises();

    expect(previewImport).toHaveBeenCalled();
    expect(wrapper.find(".file-chip-name").text()).toBe("beispiel.csv");
  });
});
