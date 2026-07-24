/**
 * Component test for LinkDetailView (04-UI-SPEC.md Link-Detail,
 * LINK-05/06/07, UI-06). Mocks `../api`; uses a lightweight test router
 * (own route table, no auth guard) so `route.params.id` and
 * `router.push` navigation resolve without a real session.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { DomainDTO, LinkAnalyticsDTO, LinkDTO, QrCodeDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import LinkDetailView from "./LinkDetailView.vue";
import { ApiError } from "../api";

const {
  createQrCode,
  deleteLink,
  getLink,
  getLinkAnalytics,
  listDomains,
  listQrCodes,
  updateLink,
} = vi.hoisted(() => ({
  createQrCode: vi.fn(),
  deleteLink: vi.fn(),
  getLink: vi.fn(),
  getLinkAnalytics: vi.fn(),
  listDomains: vi.fn(),
  listQrCodes: vi.fn(),
  updateLink: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    createQrCode,
    deleteLink,
    getLink,
    getLinkAnalytics,
    listDomains,
    listQrCodes,
    updateLink,
  };
});

function makeAnalytics(overrides: Partial<LinkAnalyticsDTO> = {}): LinkAnalyticsDTO {
  return {
    totalClicks: 0,
    last7Days: 0,
    topReferrer: null,
    dailySeries: Array.from({ length: 30 }, (_, i) => ({
      day: `2026-06-${String(i + 1).padStart(2, "0")}`,
      count: 0,
    })),
    topReferrers: [],
    topCountries: [],
    ...overrides,
  };
}

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

/**
 * 07-09 (Surface B, QR-01): the "QR-Code" entry-point button looks up
 * any existing static QR for this link via `listQrCodes` (no by-link
 * query param on `GET /api/qr-codes` — filtered client-side).
 */
function makeQrCode(overrides: Partial<QrCodeDTO> = {}): QrCodeDTO {
  return {
    id: "qr1",
    variant: "static",
    linkId: "l1",
    code: null,
    name: "QR für /abc123",
    color: "#17170f",
    roundedModules: false,
    logoEnabled: false,
    hasLogo: false,
    lifetimeScans: 0,
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
      { path: "/links", name: "links", component: { template: "<div>links</div>" } },
      { path: "/links/:id", name: "link-detail", component: LinkDetailView },
      { path: "/qr-codes", name: "qr-codes", component: { template: "<div>qr-codes</div>" } },
    ],
  });
}

beforeEach(() => {
  createQrCode.mockReset();
  deleteLink.mockReset();
  getLink.mockReset();
  getLinkAnalytics.mockReset();
  getLinkAnalytics.mockResolvedValue(makeAnalytics());
  listDomains.mockReset();
  listQrCodes.mockReset();
  updateLink.mockReset();
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountDetailView(id = "l1") {
  const router = makeRouter();
  await router.push(`/links/${id}`);
  await router.isReady();
  const wrapper = mount(LinkDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe("LinkDetailView", () => {
  it("renders the link attributes from getLink", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    getLink.mockResolvedValue(makeLink({ slug: "abc123", targetUrl: "https://example.com/target" }));

    const { wrapper } = await mountDetailView();

    expect(getLink).toHaveBeenCalledWith("l1");
    expect(wrapper.find(".link-slug").text()).toBe("/abc123");
    expect(wrapper.find(".link-target").text()).toBe("➜ https://example.com/target");
    expect(wrapper.text()).toContain("s.meinefirma.de");
  });

  it("tracking card shows the ON hint copy and an active toggle when tracking is enabled", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink({ trackingEnabled: true }));

    const { wrapper } = await mountDetailView();

    expect(wrapper.find(".tracking-title").text()).toBe("Internes Tracking");
    expect(wrapper.find(".tracking-hint").text()).toBe(
      "Klicks, Referrer und Länder werden erfasst (nur intern, keine Drittanbieter).",
    );
    expect(wrapper.find(".toggle").classes()).toContain("active");
  });

  it("tracking card shows the OFF hint copy and an inactive toggle when tracking is disabled", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink({ trackingEnabled: false }));

    const { wrapper } = await mountDetailView();

    expect(wrapper.find(".tracking-hint").text()).toBe("Keine Datenerfassung für diesen Link.");
    expect(wrapper.find(".toggle").classes()).not.toContain("active");
  });

  it("tracking-off: only the dashed empty state renders, no stat cards, no analytics call", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink({ trackingEnabled: false }));

    const { wrapper } = await mountDetailView();

    expect(wrapper.find(".dashed-empty").text()).toBe(
      "Tracking ist für diesen Link deaktiviert — es werden keine Klickdaten gespeichert.",
    );
    expect(wrapper.find(".stat-grid").exists()).toBe(false);
    expect(getLinkAnalytics).not.toHaveBeenCalled();
  });

  it("toggle: clicking optimistically flips state, PATCHes via updateLink, and shows NO success toast", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink({ trackingEnabled: true }));
    updateLink.mockResolvedValue(makeLink({ trackingEnabled: false }));

    const { wrapper } = await mountDetailView();

    await wrapper.find(".toggle").trigger("click");
    await flushPromises();

    expect(updateLink).toHaveBeenCalledWith("l1", { trackingEnabled: false });
    expect(wrapper.find(".toggle").classes()).not.toContain("active");
    expect(wrapper.find(".dashed-empty").exists()).toBe(true);
    expect(wrapper.find(".toast").exists()).toBe(false);
  });

  it("toggle: a failed PATCH reverts the optimistic flip and toasts the failure copy", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink({ trackingEnabled: true }));
    updateLink.mockRejectedValue(new Error("network error"));

    const { wrapper } = await mountDetailView();

    await wrapper.find(".toggle").trigger("click");
    await flushPromises();

    expect(wrapper.find(".toggle").classes()).toContain("active");
    expect(wrapper.find(".toast").text()).toBe("Tracking konnte nicht geändert werden.");
  });

  it("data state: 3 stat cards, exactly 30 chart bars, referrer/country rows with Direkt/Unbekannt for nulls", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink({ trackingEnabled: true }));
    getLinkAnalytics.mockResolvedValue(
      makeAnalytics({
        totalClicks: 42,
        last7Days: 5,
        topReferrer: "google.com",
        topReferrers: [
          { host: "google.com", count: 10 },
          { host: null, count: 4 },
        ],
        topCountries: [
          { country: "DE", count: 8 },
          { country: null, count: 2 },
        ],
      }),
    );

    const { wrapper } = await mountDetailView();

    expect(wrapper.findAll(".bar")).toHaveLength(30);
    expect(wrapper.findAll(".stat-value").map((n) => n.text())).toEqual(["42", "5", "google.com"]);
    expect(wrapper.findAll(".row-name").map((n) => n.text())).toEqual([
      "google.com",
      "Direkt",
      "DE",
      "Unbekannt",
    ]);
    expect(wrapper.find(".dashed-empty").exists()).toBe(false);
    expect(wrapper.find(".zero-data-hint").exists()).toBe(false);
    expect(wrapper.find(".skeleton-block").exists()).toBe(false);
  });

  it("zero-data state: card shells with 0/–, chart hint, and 'Keine Daten' list rows", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink({ trackingEnabled: true }));
    getLinkAnalytics.mockResolvedValue(makeAnalytics({ totalClicks: 0 }));

    const { wrapper } = await mountDetailView();

    expect(wrapper.findAll(".stat-value").map((n) => n.text())).toEqual(["0", "0", "–"]);
    expect(wrapper.find(".zero-data-hint").text()).toBe(
      "Noch keine Klicks erfasst — Daten erscheinen, sobald der Link aufgerufen wird.",
    );
    expect(wrapper.findAll(".list-empty-row")).toHaveLength(2);
    expect(wrapper.findAll(".list-empty-row").every((n) => n.text() === "Keine Daten")).toBe(true);
    expect(wrapper.find(".bar").exists()).toBe(false);
  });

  it("loading state: shows skeleton blocks (no spinner) while analytics fetches, never alongside data/zero-data", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink({ trackingEnabled: true }));
    let resolveAnalytics!: (value: LinkAnalyticsDTO) => void;
    getLinkAnalytics.mockReturnValue(
      new Promise<LinkAnalyticsDTO>((resolve) => {
        resolveAnalytics = resolve;
      }),
    );

    const router = makeRouter();
    await router.push("/links/l1");
    await router.isReady();
    const wrapper = mount(LinkDetailView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.findAll(".skeleton-block").length).toBeGreaterThan(0);
    expect(wrapper.find(".zero-data-hint").exists()).toBe(false);
    expect(wrapper.find(".bar").exists()).toBe(false);
    expect(wrapper.find(".list-empty-row").exists()).toBe(false);

    resolveAnalytics(makeAnalytics({ totalClicks: 0 }));
    await flushPromises();

    expect(wrapper.find(".skeleton-block").exists()).toBe(false);
    expect(wrapper.find(".zero-data-hint").exists()).toBe(true);
  });

  it("copy composes the FULL https URL and toasts 'Link kopiert'", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    getLink.mockResolvedValue(makeLink({ domainId: "d1", slug: "abc123" }));

    const { wrapper } = await mountDetailView();

    // Action-row order (07-09): QR-Code(0), Kopieren(1), Bearbeiten(2), Löschen(3).
    await wrapper.findAll(".action-button")[1]!.trigger("click");
    await flushPromises();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://s.meinefirma.de/abc123");
    expect(wrapper.find(".toast").text()).toBe("Link kopiert");
  });

  it("edit opens the modal (with the D-04 warning) and calls updateLink", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    getLink.mockResolvedValue(
      makeLink({ id: "l1", domainId: "d1", slug: "abc123", targetUrl: "https://example.com/1" }),
    );
    updateLink.mockResolvedValue(
      makeLink({ id: "l1", domainId: "d1", slug: "new-slug", targetUrl: "https://example.com/1" }),
    );

    const { wrapper } = await mountDetailView();

    const buttons = wrapper.findAll(".action-button");
    await buttons[2]!.trigger("click"); // ✎ Bearbeiten (07-09: index shifted by the new QR-Code button)
    await flushPromises();

    expect(wrapper.text()).toContain("Achtung: Slug-Änderung");

    const slugInput = wrapper.findAll(".field-input.mono")[1]!;
    await slugInput.setValue("new-slug");
    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(updateLink).toHaveBeenCalledWith("l1", {
      targetUrl: "https://example.com/1",
      slug: "new-slug",
      password: undefined,
      expiresAt: undefined,
      forwardQuery: false,
      trackingEnabled: true,
    });
    expect(wrapper.text()).toContain("Änderungen gespeichert");
  });

  it("edit preserves a tracking-OFF link's trackingEnabled through the PATCH", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    getLink.mockResolvedValue(
      makeLink({
        id: "l1",
        domainId: "d1",
        slug: "abc123",
        targetUrl: "https://example.com/1",
        trackingEnabled: false,
      }),
    );
    updateLink.mockResolvedValue(
      makeLink({
        id: "l1",
        domainId: "d1",
        slug: "abc123",
        targetUrl: "https://example.com/1",
        trackingEnabled: false,
      }),
    );

    const { wrapper } = await mountDetailView();

    const buttons = wrapper.findAll(".action-button");
    await buttons[2]!.trigger("click"); // ✎ Bearbeiten
    await flushPromises();

    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(updateLink).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({ trackingEnabled: false }),
    );
  });

  it("flipping the modal's tracking toggle is applied on save", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    getLink.mockResolvedValue(
      makeLink({
        id: "l1",
        domainId: "d1",
        slug: "abc123",
        targetUrl: "https://example.com/1",
        trackingEnabled: true,
      }),
    );
    updateLink.mockResolvedValue(
      makeLink({
        id: "l1",
        domainId: "d1",
        slug: "abc123",
        targetUrl: "https://example.com/1",
        trackingEnabled: false,
      }),
    );

    const { wrapper } = await mountDetailView();

    const buttons = wrapper.findAll(".action-button");
    await buttons[2]!.trigger("click"); // ✎ Bearbeiten
    await flushPromises();

    await wrapper.find(".tracking-toggle-group .toggle").trigger("click");
    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(updateLink).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({ trackingEnabled: false }),
    );
  });

  it("WR-09: a non-ApiError edit failure (e.g. a network error) surfaces a fallback toast instead of failing silently", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    getLink.mockResolvedValue(
      makeLink({ id: "l1", domainId: "d1", slug: "abc123", targetUrl: "https://example.com/1" }),
    );
    updateLink.mockRejectedValue(new TypeError("Failed to fetch"));

    const { wrapper } = await mountDetailView();

    const buttons = wrapper.findAll(".action-button");
    await buttons[2]!.trigger("click"); // ✎ Bearbeiten (07-09: index shifted by the new QR-Code button)
    await flushPromises();

    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(wrapper.find(".toast").text()).toBe("Speichern fehlgeschlagen. Bitte erneut versuchen.");
  });

  it("delete requires confirmation, calls deleteLink, toasts, then navigates to /links", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1" })]);
    getLink.mockResolvedValue(makeLink({ id: "l1", domainId: "d1" }));
    deleteLink.mockResolvedValue(undefined);

    const { wrapper, router } = await mountDetailView();

    const buttons = wrapper.findAll(".action-button");
    await buttons[3]!.trigger("click"); // 🗑 Löschen (07-09: index shifted by the new QR-Code button)
    await flushPromises();

    expect(wrapper.find(".delete-dialog").exists()).toBe(true);
    expect(deleteLink).not.toHaveBeenCalled();

    await wrapper.find(".delete-confirm-button").trigger("click");
    await flushPromises();

    expect(deleteLink).toHaveBeenCalledWith("l1");
    expect(wrapper.find(".toast").text()).toBe("Link gelöscht");

    // Navigation is deliberately delayed (per-view toast pattern) so the
    // toast is visible before this view unmounts — wait it out for real.
    await new Promise((resolve) => setTimeout(resolve, 950));
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("links");
  });

  // 07-09 (Surface B, QR-01): the "QR-Code" action button (first position,
  // no icon) either deep-links to an existing static QR or creates one on
  // the spot (no dialog) then deep-links and toasts.
  it("QR-Code: deep-links to an existing static QR for this link without creating a new one", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1" })]);
    getLink.mockResolvedValue(makeLink({ id: "l1", domainId: "d1", slug: "abc123" }));
    listQrCodes.mockResolvedValue([
      makeQrCode({ id: "qr-static", variant: "static", linkId: "l1" }),
      makeQrCode({ id: "qr-other", variant: "dynamic", linkId: "l9" }),
    ]);

    const { wrapper, router } = await mountDetailView();

    await wrapper.findAll(".action-button")[0]!.trigger("click"); // QR-Code
    await flushPromises();

    expect(listQrCodes).toHaveBeenCalled();
    expect(createQrCode).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("qr-codes");
    expect(router.currentRoute.value.query.selected).toBe("qr-static");
  });

  it("QR-Code: creates a static QR with the default name when none exists, then deep-links and toasts", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1" })]);
    getLink.mockResolvedValue(makeLink({ id: "l1", domainId: "d1", slug: "abc123" }));
    listQrCodes.mockResolvedValue([]);
    createQrCode.mockResolvedValue(makeQrCode({ id: "qr-new", variant: "static", linkId: "l1" }));

    const { wrapper, router } = await mountDetailView();

    await wrapper.findAll(".action-button")[0]!.trigger("click"); // QR-Code
    await flushPromises();

    expect(createQrCode).toHaveBeenCalledWith({
      variant: "static",
      linkId: "l1",
      name: "QR für /abc123",
    });
    expect(router.currentRoute.value.name).toBe("qr-codes");
    expect(router.currentRoute.value.query.selected).toBe("qr-new");
    expect(wrapper.find(".toast").text()).toBe("QR-Code erstellt");
  });

  it("shows a not-found state and does not crash when getLink 404s", async () => {
    listDomains.mockResolvedValue([]);
    getLink.mockRejectedValue(new ApiError(404, "Not Found"));

    const { wrapper } = await mountDetailView("missing");

    expect(wrapper.text()).toContain("Link nicht gefunden");
  });

  // Phase 8 (08-06 Task 2, 08-UI-SPEC.md Surface D, META-01/02, UI-08-07):
  // payload threading for the UTM/OG sections built in 08-04/08-05, and
  // the two new metadata chips.
  describe("UTM/OG payload threading and metadata chips (Surface D)", () => {
    it("opening the edit modal pre-fills all six fields from the link", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      getLink.mockResolvedValue(
        makeLink({
          id: "l1",
          domainId: "d1",
          slug: "abc123",
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "launch",
          ogTitle: "Ein Titel",
          ogDescription: "Eine Beschreibung",
          ogImageUrl: "https://example.com/og.png",
        }),
      );

      const { wrapper } = await mountDetailView();

      const buttons = wrapper.findAll(".action-button");
      await buttons[2]!.trigger("click"); // ✎ Bearbeiten
      await flushPromises();

      await wrapper.find(".accordion-header--utm").trigger("click");
      const utmInputs = wrapper.findAll(".utm-input");
      expect((utmInputs[0]!.element as HTMLInputElement).value).toBe("newsletter");
      expect((utmInputs[1]!.element as HTMLInputElement).value).toBe("email");
      expect((utmInputs[2]!.element as HTMLInputElement).value).toBe("launch");

      await wrapper.find(".accordion-header--og").trigger("click");
      const ogInputs = wrapper.findAll(".og-input");
      expect((ogInputs[0]!.element as HTMLInputElement).value).toBe("Ein Titel");
      expect((ogInputs[1]!.element as HTMLInputElement).value).toBe("Eine Beschreibung");
      expect((ogInputs[2]!.element as HTMLInputElement).value).toBe("https://example.com/og.png");
    });

    it("saving forwards the modal's payload unchanged, including explicit null clears", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      getLink.mockResolvedValue(
        makeLink({
          id: "l1",
          domainId: "d1",
          slug: "abc123",
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "launch",
          ogTitle: "Ein Titel",
          ogDescription: "Eine Beschreibung",
          ogImageUrl: "https://example.com/og.png",
        }),
      );
      updateLink.mockResolvedValue(makeLink({ id: "l1", domainId: "d1", slug: "abc123" }));

      const { wrapper } = await mountDetailView();

      const buttons = wrapper.findAll(".action-button");
      await buttons[2]!.trigger("click"); // ✎ Bearbeiten
      await flushPromises();

      await wrapper.find(".accordion-header--utm").trigger("click");
      const utmInputs = wrapper.findAll(".utm-input");
      await utmInputs[0]!.setValue("");
      await utmInputs[1]!.setValue("");
      await utmInputs[2]!.setValue("");

      await wrapper.find(".accordion-header--og").trigger("click");
      const ogInputs = wrapper.findAll(".og-input");
      await ogInputs[0]!.setValue("");
      await ogInputs[1]!.setValue("");
      await ogInputs[2]!.setValue("");

      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(updateLink).toHaveBeenCalledWith(
        "l1",
        expect.objectContaining({
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
        }),
      );
    });

    it("a failed save carrying the OG-image-url-invalid code renders the locked message beneath the image-URL input inside the still-open modal", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      getLink.mockResolvedValue(
        makeLink({ id: "l1", domainId: "d1", slug: "abc123", targetUrl: "https://example.com/1" }),
      );
      updateLink.mockRejectedValue(new ApiError(400, "Bad Request", "OG_IMAGE_URL_INVALID"));

      const { wrapper } = await mountDetailView();

      const buttons = wrapper.findAll(".action-button");
      await buttons[2]!.trigger("click"); // ✎ Bearbeiten
      await flushPromises();

      await wrapper.find(".accordion-header--og").trigger("click");
      await wrapper.findAll(".og-input")[2]!.setValue("javascript:alert(1)");

      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(wrapper.find(".modal-dialog").exists()).toBe(true);
      expect(wrapper.find(".accordion-body--og .field-error").text()).toBe(
        "Bitte eine vollständige Bild-URL mit http:// oder https:// angeben.",
      );
    });

    it("shows the UTM chip and OG chip, in order, after the hostname/created chips, only when those values are set", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      getLink.mockResolvedValue(
        makeLink({
          id: "l1",
          domainId: "d1",
          slug: "abc123",
          utmSource: "newsletter",
          ogTitle: "Ein Titel",
        }),
      );

      const { wrapper } = await mountDetailView();

      const chips = wrapper.findAll(".chip");
      expect(chips.map((c) => c.text())).toEqual([
        "s.meinefirma.de",
        expect.stringContaining("erstellt"),
        "UTM-Parameter gesetzt",
        "Custom OG-Tags",
      ]);
    });

    it("neither chip renders when the link carries no UTM or OG values", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      getLink.mockResolvedValue(makeLink({ id: "l1", domainId: "d1", slug: "abc123" }));

      const { wrapper } = await mountDetailView();

      expect(wrapper.text()).not.toContain("UTM-Parameter gesetzt");
      expect(wrapper.text()).not.toContain("Custom OG-Tags");
    });

    it("after a successful save the chips update in place from the returned DTO, without a reload", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      getLink.mockResolvedValue(
        makeLink({ id: "l1", domainId: "d1", slug: "abc123", targetUrl: "https://example.com/1" }),
      );
      updateLink.mockResolvedValue(
        makeLink({
          id: "l1",
          domainId: "d1",
          slug: "abc123",
          targetUrl: "https://example.com/1",
          utmCampaign: "launch",
        }),
      );

      const { wrapper } = await mountDetailView();

      expect(wrapper.text()).not.toContain("UTM-Parameter gesetzt");

      const buttons = wrapper.findAll(".action-button");
      await buttons[2]!.trigger("click"); // ✎ Bearbeiten
      await flushPromises();
      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(wrapper.text()).toContain("UTM-Parameter gesetzt");
    });

    it("the destination line keeps showing the stored target URL without any UTM parameters appended (UI-08-07)", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      getLink.mockResolvedValue(
        makeLink({
          id: "l1",
          domainId: "d1",
          slug: "abc123",
          targetUrl: "https://example.com/1",
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "launch",
        }),
      );

      const { wrapper } = await mountDetailView();

      expect(wrapper.find(".link-target").text()).toBe("➜ https://example.com/1");
      expect(wrapper.find(".link-target").text()).not.toContain("utm_");
    });
  });
});
