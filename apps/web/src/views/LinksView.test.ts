/**
 * Component test for LinksView (04-UI-SPEC.md Links-Liste, LINK-03/04/06/07,
 * UI-06). Mocks the `../api` module (mirrors DomainsView.test.ts's
 * `vi.mock` pattern) — no real network happens. Uses a lightweight test
 * router (own route table, no auth guard) so `router.push`/RouterLink-free
 * navigation calls (`openDetail`/`goToImport`) resolve without needing a
 * real session — see 04-02/03/04's integration coverage for actual
 * server-side behavior.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { DomainDTO, LinkDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import LinksView from "./LinksView.vue";

const { createLink, deleteLink, listDomains, listLinks, updateLink } = vi.hoisted(() => ({
  createLink: vi.fn(),
  deleteLink: vi.fn(),
  listDomains: vi.fn(),
  listLinks: vi.fn(),
  updateLink: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, createLink, deleteLink, listDomains, listLinks, updateLink };
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

function makeLink(overrides: Partial<LinkDTO> = {}): LinkDTO {
  return {
    id: "l1",
    domainId: "d1",
    slug: "abc123",
    targetUrl: "https://example.com/target",
    title: null,
    createdBy: "u1",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/links", name: "links", component: LinksView },
      { path: "/links/:id", name: "link-detail", component: { template: "<div>detail</div>" } },
      { path: "/links/import", name: "links-import", component: { template: "<div>import</div>" } },
    ],
  });
}

beforeEach(() => {
  createLink.mockReset();
  deleteLink.mockReset();
  listDomains.mockReset();
  listLinks.mockReset();
  updateLink.mockReset();
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountLinksView() {
  const router = makeRouter();
  await router.push("/links");
  await router.isReady();
  const wrapper = mount(LinksView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe("LinksView", () => {
  it("renders the empty state when there are no links and no filter is active", async () => {
    listDomains.mockResolvedValue([]);
    listLinks.mockResolvedValue([]);

    const { wrapper } = await mountLinksView();

    expect(wrapper.text()).toContain("Noch keine Links");
    expect(wrapper.find(".links-card").exists()).toBe(false);
  });

  it("renders the returned links in the table", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    listLinks.mockResolvedValue([
      makeLink({ id: "l1", slug: "abc123", targetUrl: "https://example.com/1" }),
      makeLink({ id: "l2", slug: "xyz789", targetUrl: "https://example.com/2" }),
    ]);

    const { wrapper } = await mountLinksView();

    const rows = wrapper.findAll(".table-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("/abc123");
    expect(rows[0]!.text()).toContain("s.meinefirma.de");
    expect(rows[1]!.text()).toContain("/xyz789");
  });

  it("typing in the search field calls listLinks with the matching q param", async () => {
    listDomains.mockResolvedValue([]);
    listLinks.mockResolvedValue([]);

    const { wrapper } = await mountLinksView();
    listLinks.mockClear();

    await wrapper.find(".search-input").setValue("hello");
    await flushPromises();

    expect(listLinks).toHaveBeenCalledWith({ q: "hello" });
  });

  it("clicking a domain filter tab calls listLinks with the matching domainId param", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([]);

    const { wrapper } = await mountLinksView();
    listLinks.mockClear();

    const tabs = wrapper.findAll(".tab-pill");
    // tabs[0] is "alle Domains"; tabs[1] is the one accessible domain.
    await tabs[1]!.trigger("click");
    await flushPromises();

    expect(listLinks).toHaveBeenCalledWith({ domainId: "d1" });
  });

  it("creating a link calls createLink and toasts '{domain}/{slug} erstellt'", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([]);
    createLink.mockResolvedValue(
      makeLink({ id: "new1", domainId: "d1", slug: "neu1", targetUrl: "https://example.com/n" }),
    );

    const { wrapper } = await mountLinksView();

    await wrapper.find(".primary-button").trigger("click");
    await flushPromises();

    await wrapper.find(".field-input.mono").setValue("https://example.com/n");
    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(createLink).toHaveBeenCalledWith({
      domainId: "d1",
      targetUrl: "https://example.com/n",
      slug: undefined,
    });
    expect(wrapper.find(".toast").text()).toBe("s.meinefirma.de/neu1 erstellt");
  });

  it("copy composes the FULL https URL, calls the clipboard, and toasts 'Link kopiert'", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([makeLink({ id: "l1", domainId: "d1", slug: "abc123" })]);

    const { wrapper } = await mountLinksView();

    await wrapper.find(".row-action[title='Kopieren']").trigger("click");
    await flushPromises();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://s.meinefirma.de/abc123",
    );
    expect(wrapper.find(".toast").text()).toBe("Link kopiert");
  });

  it("delete requires confirmation, then calls deleteLink and toasts 'Link gelöscht'", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([makeLink({ id: "l1", domainId: "d1", slug: "abc123" })]);
    deleteLink.mockResolvedValue(undefined);

    const { wrapper } = await mountLinksView();

    await wrapper.find(".row-action.delete").trigger("click");
    await flushPromises();

    expect(wrapper.find(".delete-dialog").exists()).toBe(true);
    expect(deleteLink).not.toHaveBeenCalled();

    await wrapper.find(".delete-confirm-button").trigger("click");
    await flushPromises();

    expect(deleteLink).toHaveBeenCalledWith("l1");
    expect(wrapper.find(".table-row").exists()).toBe(false);
    expect(wrapper.find(".toast").text()).toBe("Link gelöscht");
  });

  it("clicking a row navigates to /links/:id", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1" })]);
    listLinks.mockResolvedValue([makeLink({ id: "l1", domainId: "d1" })]);

    const { wrapper, router } = await mountLinksView();

    await wrapper.find(".table-row").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("link-detail");
    expect(router.currentRoute.value.params.id).toBe("l1");
  });

  it("the Import button navigates to /links/import", async () => {
    listDomains.mockResolvedValue([]);
    listLinks.mockResolvedValue([]);

    const { wrapper, router } = await mountLinksView();

    await wrapper.find(".import-button").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("links-import");
  });

  it("edit mode renders the D-04 slug-change warning and saves via updateLink", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([
      makeLink({ id: "l1", domainId: "d1", slug: "abc123", targetUrl: "https://example.com/1" }),
    ]);
    updateLink.mockResolvedValue(
      makeLink({ id: "l1", domainId: "d1", slug: "new-slug", targetUrl: "https://example.com/1" }),
    );

    const { wrapper } = await mountLinksView();

    await wrapper.find(".row-action[title='Bearbeiten']").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Achtung: Slug-Änderung");

    const slugInput = wrapper.findAll(".field-input.mono")[1]!;
    await slugInput.setValue("new-slug");
    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(updateLink).toHaveBeenCalledWith("l1", {
      targetUrl: "https://example.com/1",
      slug: "new-slug",
    });
    expect(wrapper.text()).toContain("Änderungen gespeichert");
  });
});
