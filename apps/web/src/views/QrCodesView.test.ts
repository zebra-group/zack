/**
 * Component test for QrCodesView (07-UI-SPEC.md Surface A, QR-02/03/04/07)
 * — replaces `ComingSoonView` at route `/qr-codes`. Mocks the `../api`
 * module (mirrors LinksView.test.ts's `vi.mock` pattern) — no real network
 * happens. Uses a lightweight test router (own route table, no auth guard)
 * so `?selected={qrId}` deep-linking resolves without needing a real
 * session.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { LinkDTO, QrCodeDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import QrCodesView from "./QrCodesView.vue";

const { createQrCode, listLinks, listQrCodes } = vi.hoisted(() => ({
  createQrCode: vi.fn(),
  listLinks: vi.fn(),
  listQrCodes: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, createQrCode, listLinks, listQrCodes };
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
  listLinks.mockReset();
  listQrCodes.mockReset();
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
});
