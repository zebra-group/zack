/**
 * Component test for QrCodesView (07-UI-SPEC.md Surface A, QR-02/03/04/07)
 * — replaces `ComingSoonView` at route `/qr-codes`. Mocks the `../api`
 * module (mirrors LinksView.test.ts's `vi.mock` pattern) — no real network
 * happens. Uses a lightweight test router (own route table, no auth guard)
 * so `?selected={qrId}` deep-linking resolves without needing a real
 * session.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { LinkDTO, QrCodeDTO, QrRemapHistoryEntryDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import QrCodesView from "./QrCodesView.vue";
import QrStudioPanel from "../components/QrStudioPanel.vue";

const { createQrCode, deleteQrCode, getQrRemapHistory, listLinks, listQrCodes, remapQrCode } = vi.hoisted(
  () => ({
    createQrCode: vi.fn(),
    deleteQrCode: vi.fn(),
    getQrRemapHistory: vi.fn(),
    listLinks: vi.fn(),
    listQrCodes: vi.fn(),
    remapQrCode: vi.fn(),
  }),
);

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, createQrCode, deleteQrCode, getQrRemapHistory, listLinks, listQrCodes, remapQrCode };
});

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
    passwordProtected: false,
    expiresAt: null,
    forwardQuery: false,
    trackingEnabled: true,
    lifetimeClicks: 0,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    ogTitle: null,
    ogDescription: null,
    ogImageUrl: null,
    ...overrides,
  };
}

function makeQrCode(overrides: Partial<QrCodeDTO> = {}): QrCodeDTO {
  return {
    id: "qr1",
    variant: "dynamic",
    linkId: "l1",
    code: "abc1234",
    name: "Neuer QR-Code",
    color: "#17170f",
    roundedModules: false,
    logoEnabled: false,
    hasLogo: false,
    lifetimeScans: 0,
    createdBy: "u1",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/qr-codes", name: "qr-codes", component: QrCodesView }],
  });
}

beforeEach(() => {
  createQrCode.mockReset();
  deleteQrCode.mockReset();
  getQrRemapHistory.mockReset();
  listLinks.mockReset();
  listQrCodes.mockReset();
  remapQrCode.mockReset();
  // Default: no history for any QR unless a test overrides it — every
  // dynamic card fetches its own history on load (Task 3).
  getQrRemapHistory.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function mountQrCodesView(path = "/qr-codes") {
  const router = makeRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(QrCodesView, { global: { plugins: [router] } });
  return { wrapper, router };
}

describe("QrCodesView", () => {
  it("renders the loading skeleton before the fetch resolves", async () => {
    let resolveList: (value: QrCodeDTO[]) => void = () => {};
    listQrCodes.mockReturnValue(new Promise((resolve) => (resolveList = resolve)));
    listLinks.mockResolvedValue([]);

    const { wrapper } = await mountQrCodesView();

    expect(wrapper.find(".loading-skeleton").exists()).toBe(true);
    expect(wrapper.find(".empty-state").exists()).toBe(false);
    expect(wrapper.find(".error-state").exists()).toBe(false);
    expect(wrapper.find(".data-row").exists()).toBe(false);

    resolveList([]);
    await flushPromises();
  });

  it("renders the error state when loading fails, and retry re-fetches", async () => {
    listQrCodes.mockRejectedValueOnce(new Error("network down"));
    listLinks.mockResolvedValue([]);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    expect(wrapper.find(".error-state").exists()).toBe(true);
    expect(wrapper.text()).toContain("QR-Codes konnten nicht geladen werden");
    expect(wrapper.find(".loading-skeleton").exists()).toBe(false);

    listQrCodes.mockResolvedValueOnce([]);
    listLinks.mockResolvedValueOnce([]);
    await wrapper.find(".retry-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".error-state").exists()).toBe(false);
    expect(wrapper.find(".empty-state").exists()).toBe(true);
  });

  it("renders the empty state when there are no QR codes", async () => {
    listQrCodes.mockResolvedValue([]);
    listLinks.mockResolvedValue([makeLink()]);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.text()).toContain("Noch keine QR-Codes");
    expect(wrapper.find(".data-row").exists()).toBe(false);
  });

  it("renders the data state with one card per QR code", async () => {
    const links = [makeLink({ id: "l1", slug: "abc123" })];
    const qrCodes = [
      makeQrCode({ id: "qr1", variant: "dynamic", code: "xyz9876", linkId: "l1", lifetimeScans: 42 }),
      makeQrCode({ id: "qr2", variant: "static", code: null, linkId: "l1", name: "QR für /abc123" }),
    ];
    listQrCodes.mockResolvedValue(qrCodes);
    listLinks.mockResolvedValue(links);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    expect(wrapper.find(".data-row").exists()).toBe(true);
    const cards = wrapper.findAll(".qr-card");
    expect(cards).toHaveLength(2);

    expect(cards[0]?.text()).toContain("/q/xyz9876");
    expect(cards[0]?.text()).toContain("DYNAMISCH");
    expect(cards[0]?.text()).toContain("42");
    expect(cards[0]?.find("select").attributes("disabled")).toBeUndefined();

    expect(cards[1]?.text()).toContain("/abc123");
    expect(cards[1]?.text()).toContain("STATISCH");
    expect(cards[1]?.find("select").attributes("disabled")).toBeDefined();
  });

  it("'+ Dynamischer QR' creates immediately (no dialog), prepends + selects the card, and toasts", async () => {
    const links = [makeLink({ id: "l1", slug: "abc123" })];
    listQrCodes.mockResolvedValue([]);
    listLinks.mockResolvedValue(links);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    const created = makeQrCode({ id: "qr-new", variant: "dynamic", code: "new0001", linkId: "l1" });
    createQrCode.mockResolvedValue(created);

    await wrapper.find(".primary-button").trigger("click");
    await flushPromises();

    expect(createQrCode).toHaveBeenCalledWith({
      variant: "dynamic",
      linkId: "l1",
      name: "Neuer QR-Code",
    });
    const cards = wrapper.findAll(".qr-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.classes()).toContain("selected");
    expect(wrapper.find(".toast").text()).toBe("Dynamischer QR erstellt");
  });

  it("preselects the card referenced by ?selected= on load", async () => {
    const links = [makeLink({ id: "l1", slug: "abc123" })];
    const qrCodes = [
      makeQrCode({ id: "qr1", linkId: "l1" }),
      makeQrCode({ id: "qr2", linkId: "l1" }),
    ];
    listQrCodes.mockResolvedValue(qrCodes);
    listLinks.mockResolvedValue(links);

    const { wrapper } = await mountQrCodesView("/qr-codes?selected=qr2");
    await flushPromises();

    const cards = wrapper.findAll(".qr-card");
    expect(cards[0]?.classes()).not.toContain("selected");
    expect(cards[1]?.classes()).toContain("selected");
  });

  it("remaps a dynamic QR's target optimistically and toasts success", async () => {
    const links = [makeLink({ id: "l1", slug: "abc123" }), makeLink({ id: "l2", slug: "zzz999" })];
    const qrCodes = [makeQrCode({ id: "qr1", variant: "dynamic", linkId: "l1", name: "Mein QR" })];
    listQrCodes.mockResolvedValue(qrCodes);
    listLinks.mockResolvedValue(links);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    let resolveRemap: (value: QrCodeDTO) => void = () => {};
    remapQrCode.mockReturnValue(new Promise((resolve) => (resolveRemap = resolve)));

    const select = wrapper.find(".qr-card select");
    await select.setValue("l2");

    // Optimistic: the select already reflects the new target before the
    // remapQrCode promise resolves.
    expect((select.element as HTMLSelectElement).value).toBe("l2");
    expect(remapQrCode).toHaveBeenCalledWith("qr1", "l2");

    resolveRemap(makeQrCode({ id: "qr1", variant: "dynamic", linkId: "l2", name: "Mein QR" }));
    await flushPromises();

    expect(wrapper.find(".toast").text()).toBe("Mein QR zeigt jetzt auf /zzz999");
  });

  /**
   * IN-08 regression: the synthetic post-remap history entry used
   * `local-${Date.now()}` as its id, which is also the `:key` for the
   * Verlauf `v-for`. Two remaps landing in the same millisecond produced
   * duplicate keys — Vue warns and can mis-patch the list. Freezing
   * `Date.now` reproduces that collision deterministically.
   */
  it("gives every synthetic remap-history entry a unique key even within one millisecond", async () => {
    const links = [
      makeLink({ id: "l1", slug: "abc123" }),
      makeLink({ id: "l2", slug: "zzz999" }),
      makeLink({ id: "l3", slug: "yyy888" }),
    ];
    const qrCodes = [makeQrCode({ id: "qr1", variant: "dynamic", linkId: "l1", name: "Mein QR" })];
    listQrCodes.mockResolvedValue(qrCodes);
    listLinks.mockResolvedValue(links);
    vi.spyOn(Date, "now").mockReturnValue(1_770_000_000_000);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    const select = wrapper.find(".qr-card select");
    remapQrCode.mockResolvedValue(makeQrCode({ id: "qr1", variant: "dynamic", linkId: "l2", name: "Mein QR" }));
    await select.setValue("l2");
    await flushPromises();

    remapQrCode.mockResolvedValue(makeQrCode({ id: "qr1", variant: "dynamic", linkId: "l3", name: "Mein QR" }));
    await select.setValue("l3");
    await flushPromises();

    await wrapper.find(".verlauf-expander").trigger("click");
    await flushPromises();

    const ids = wrapper.findAll(".verlauf-row").map((row) => row.attributes("data-entry-id"));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("reverts the select and toasts failure when a remap fails", async () => {
    const links = [makeLink({ id: "l1", slug: "abc123" }), makeLink({ id: "l2", slug: "zzz999" })];
    const qrCodes = [makeQrCode({ id: "qr1", variant: "dynamic", linkId: "l1", name: "Mein QR" })];
    listQrCodes.mockResolvedValue(qrCodes);
    listLinks.mockResolvedValue(links);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    remapQrCode.mockRejectedValue(new Error("network down"));

    const select = wrapper.find(".qr-card select");
    await select.setValue("l2");
    await flushPromises();

    expect((select.element as HTMLSelectElement).value).toBe("l1");
    expect(wrapper.find(".toast").text()).toBe("Umstellung fehlgeschlagen. Bitte erneut versuchen.");
  });

  it("shows the disabled select for a static QR without a remap handler firing", async () => {
    const links = [makeLink({ id: "l1", slug: "abc123" })];
    const qrCodes = [makeQrCode({ id: "qr1", variant: "static", code: null, linkId: "l1" })];
    listQrCodes.mockResolvedValue(qrCodes);
    listLinks.mockResolvedValue(links);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    expect(wrapper.find(".qr-card select").attributes("disabled")).toBeDefined();
    expect(remapQrCode).not.toHaveBeenCalled();
  });

  it("shows the latest history line inline and reveals the full Verlauf on expand (newest first)", async () => {
    const links = [
      makeLink({ id: "l1", slug: "alt" }),
      makeLink({ id: "l2", slug: "mittel" }),
      makeLink({ id: "l3", slug: "neu" }),
    ];
    const qrCodes = [makeQrCode({ id: "qr1", variant: "dynamic", linkId: "l3" })];
    const history: QrRemapHistoryEntryDTO[] = [
      { id: "h1", qrCodeId: "qr1", fromLinkId: "l1", toLinkId: "l2", createdAt: "2026-07-10T00:00:00.000Z" },
      { id: "h2", qrCodeId: "qr1", fromLinkId: "l2", toLinkId: "l3", createdAt: "2026-07-20T00:00:00.000Z" },
    ];
    listQrCodes.mockResolvedValue(qrCodes);
    listLinks.mockResolvedValue(links);
    getQrRemapHistory.mockResolvedValue(history);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    expect(getQrRemapHistory).toHaveBeenCalledWith("qr1");

    const historyLine = wrapper.find(".history-line");
    expect(historyLine.exists()).toBe(true);
    expect(historyLine.text()).toBe("Historie: /mittel ➜ /neu (gerade geändert)");

    const expander = wrapper.find(".verlauf-expander");
    expect(expander.exists()).toBe(true);
    expect(expander.text()).toBe("Verlauf (2)");
    expect(wrapper.find(".verlauf-list").exists()).toBe(false);

    await expander.trigger("click");

    const rows = wrapper.findAll(".verlauf-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toBe("/mittel ➜ /neu · 20.07.2026");
    expect(rows[1]?.text()).toBe("/alt ➜ /mittel · 10.07.2026");
  });

  it("does not show a Verlauf expander for exactly one history entry", async () => {
    const links = [makeLink({ id: "l1", slug: "alt" }), makeLink({ id: "l2", slug: "neu" })];
    const qrCodes = [makeQrCode({ id: "qr1", variant: "dynamic", linkId: "l2" })];
    listQrCodes.mockResolvedValue(qrCodes);
    listLinks.mockResolvedValue(links);
    getQrRemapHistory.mockResolvedValue([
      { id: "h1", qrCodeId: "qr1", fromLinkId: "l1", toLinkId: "l2", createdAt: "2026-07-20T00:00:00.000Z" },
    ]);

    const { wrapper } = await mountQrCodesView();
    await flushPromises();

    expect(wrapper.find(".history-line").text()).toBe("Historie: /alt ➜ /neu (gerade geändert)");
    expect(wrapper.find(".verlauf-expander").exists()).toBe(false);
  });

  describe("delete flow (WR-07)", () => {
    it("removes the card from the list and reselects the first remaining card when the studio panel emits deleted", async () => {
      const links = [makeLink({ id: "l1", slug: "abc123" })];
      const qrCodes = [
        makeQrCode({ id: "qr1", linkId: "l1", name: "First" }),
        makeQrCode({ id: "qr2", linkId: "l1", name: "Second" }),
      ];
      listQrCodes.mockResolvedValue(qrCodes);
      listLinks.mockResolvedValue(links);

      const { wrapper } = await mountQrCodesView("/qr-codes?selected=qr1");
      await flushPromises();

      expect(wrapper.findAll(".qr-card")).toHaveLength(2);

      const studioPanel = wrapper.findComponent(QrStudioPanel);
      studioPanel.vm.$emit("deleted", "qr1");
      await flushPromises();

      const cards = wrapper.findAll(".qr-card");
      expect(cards).toHaveLength(1);
      expect(cards[0]?.text()).toContain("Second");
      expect(cards[0]?.classes()).toContain("selected");
    });

    it("reselects null (no studio panel) when the last remaining card is deleted", async () => {
      const links = [makeLink({ id: "l1", slug: "abc123" })];
      const qrCodes = [makeQrCode({ id: "qr1", linkId: "l1", name: "Only" })];
      listQrCodes.mockResolvedValue(qrCodes);
      listLinks.mockResolvedValue(links);

      const { wrapper } = await mountQrCodesView("/qr-codes?selected=qr1");
      await flushPromises();

      const studioPanel = wrapper.findComponent(QrStudioPanel);
      studioPanel.vm.$emit("deleted", "qr1");
      await flushPromises();

      expect(wrapper.findAll(".qr-card")).toHaveLength(0);
      expect(wrapper.findComponent(QrStudioPanel).exists()).toBe(false);
    });
  });
});
