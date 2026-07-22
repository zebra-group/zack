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
import { ApiError } from "../api";

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

  it("typing in the search field calls listLinks with the matching q param after the debounce (WR-08)", async () => {
    listDomains.mockResolvedValue([]);
    listLinks.mockResolvedValue([]);

    const { wrapper } = await mountLinksView();
    listLinks.mockClear();

    await wrapper.find(".search-input").setValue("hello");
    // Debounced (WR-08, 04-REVIEW.md) — wait it out for real rather than
    // mocking timers, to avoid entangling this with @vue/test-utils'
    // flushPromises (which itself uses a real setTimeout(0) internally).
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();

    expect(listLinks).toHaveBeenCalledWith({ q: "hello" });
  });

  it("WR-08: discards a stale search response that resolves after a newer one", async () => {
    listDomains.mockResolvedValue([]);
    listLinks.mockResolvedValueOnce([]); // initial load on mount

    const { wrapper } = await mountLinksView();
    listLinks.mockClear();

    let resolveStale: (value: LinkDTO[]) => void = () => {};
    const stalePromise = new Promise<LinkDTO[]>((resolve) => {
      resolveStale = resolve;
    });
    const freshResult = [makeLink({ id: "fresh", slug: "fresh-slug" })];

    listLinks.mockImplementationOnce(() => stalePromise); // first (stale) debounced call
    listLinks.mockResolvedValueOnce(freshResult); // second (fresh) debounced call

    await wrapper.find(".search-input").setValue("a");
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();

    await wrapper.find(".search-input").setValue("ab");
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();

    // Resolve the stale (first) request AFTER the fresh (second) one has
    // already resolved and rendered.
    resolveStale([makeLink({ id: "stale", slug: "stale-slug" })]);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("fresh-slug");
    expect(text).not.toContain("stale-slug");
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
      password: undefined,
      expiresAt: undefined,
      forwardQuery: false,
      trackingEnabled: true,
    });
    expect(wrapper.find(".toast").text()).toBe("s.meinefirma.de/neu1 erstellt");
  });

  it("WR-09: a non-ApiError create failure (e.g. a network error) surfaces a fallback toast instead of failing silently", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([]);
    createLink.mockRejectedValue(new TypeError("Failed to fetch"));

    const { wrapper } = await mountLinksView();

    await wrapper.find(".primary-button").trigger("click");
    await flushPromises();

    await wrapper.find(".field-input.mono").setValue("https://example.com/n");
    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(wrapper.find(".toast").text()).toBe("Speichern fehlgeschlagen. Bitte erneut versuchen.");
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
      password: undefined,
      expiresAt: undefined,
      forwardQuery: false,
      trackingEnabled: true,
    });
    expect(wrapper.text()).toContain("Änderungen gespeichert");
  });

  it("editing a protected/expiring link prefills expiry + forwardQuery, but never a password value", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([
      makeLink({
        id: "l1",
        domainId: "d1",
        slug: "abc123",
        targetUrl: "https://example.com/1",
        passwordProtected: true,
        expiresAt: "2026-08-01T23:59:59.999Z",
        forwardQuery: true,
      }),
    ]);

    const { wrapper } = await mountLinksView();

    await wrapper.find(".row-action[title='Bearbeiten']").trigger("click");
    await flushPromises();
    await wrapper.find(".accordion-header--sec").trigger("click");

    const pwInput = wrapper.find("input[type='password']");
    expect((pwInput.element as HTMLInputElement).value).toBe("");
    const dateInput = wrapper.find("input[type='date']");
    expect((dateInput.element as HTMLInputElement).value).toBe("2026-08-01");
    expect(wrapper.find(".toggle").classes()).toContain("active");
  });

  // Phase 6 (06-UI-SPEC.md § C2, TRACK-01/D-13/D-15).
  it("a tracked link renders its lifetimeClicks right-aligned in the Klicks cell", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([
      makeLink({ id: "l1", domainId: "d1", trackingEnabled: true, lifetimeClicks: 12345 }),
    ]);

    const { wrapper } = await mountLinksView();

    const cell = wrapper.find(".cell-clicks");
    expect(cell.text()).toBe("12.345");
    expect(cell.classes()).not.toContain("tracking-off");
    expect(wrapper.find(".attr-badge").exists()).toBe(false);
  });

  it("a link with tracking disabled shows the 'Tracking aus' badge and '—' in the Klicks cell (never lifetimeClicks)", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([
      makeLink({ id: "l1", domainId: "d1", trackingEnabled: false, lifetimeClicks: 42 }),
    ]);

    const { wrapper } = await mountLinksView();

    expect(wrapper.find(".attr-badge").text()).toBe("Tracking aus");
    const cell = wrapper.find(".cell-clicks");
    expect(cell.text()).toBe("—");
    expect(cell.classes()).toContain("tracking-off");
  });

  it("editing a link with tracking disabled pre-fills the form's tracking toggle as inactive", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([
      makeLink({ id: "l1", domainId: "d1", slug: "abc123", trackingEnabled: false }),
    ]);

    const { wrapper } = await mountLinksView();

    await wrapper.find(".row-action[title='Bearbeiten']").trigger("click");
    await flushPromises();

    const toggle = wrapper.find(".tracking-toggle-group .toggle");
    expect(toggle.classes()).not.toContain("active");
  });

  it("creating a link forwards trackingEnabled=false to createLink when the form toggle was switched off", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    listLinks.mockResolvedValue([]);
    createLink.mockResolvedValue(
      makeLink({ id: "new1", domainId: "d1", slug: "neu1", trackingEnabled: false }),
    );

    const { wrapper } = await mountLinksView();

    await wrapper.find(".primary-button").trigger("click");
    await flushPromises();

    await wrapper.find(".field-input.mono").setValue("https://example.com/n");
    await wrapper.find(".tracking-toggle-group .toggle").trigger("click");
    await wrapper.find(".btn-primary").trigger("click");
    await flushPromises();

    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({ trackingEnabled: false }),
    );
  });

  // Phase 8 (08-06 Task 1, 08-UI-SPEC.md Surface C, META-01/02): payload
  // threading for the UTM/OG sections built in 08-04/08-05, and the two
  // new "UTM"/"OG" attribute badges.
  describe("UTM/OG payload threading and attribute badges (Surface C)", () => {
    it("creating a link with UTM and OG values typed in the modal sends all six on the create request", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([]);
      createLink.mockResolvedValue(
        makeLink({
          id: "new1",
          domainId: "d1",
          slug: "neu1",
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "launch",
          ogTitle: "Ein Titel",
          ogDescription: "Eine Beschreibung",
          ogImageUrl: "https://example.com/og.png",
        }),
      );

      const { wrapper } = await mountLinksView();

      await wrapper.find(".primary-button").trigger("click");
      await flushPromises();

      await wrapper.find(".field-input.mono").setValue("https://example.com/n");

      await wrapper.find(".accordion-header--utm").trigger("click");
      const utmInputs = wrapper.findAll(".utm-input");
      await utmInputs[0]!.setValue("newsletter");
      await utmInputs[1]!.setValue("email");
      await utmInputs[2]!.setValue("launch");

      await wrapper.find(".accordion-header--og").trigger("click");
      const ogInputs = wrapper.findAll(".og-input");
      await ogInputs[0]!.setValue("Ein Titel");
      await ogInputs[1]!.setValue("Eine Beschreibung");
      await ogInputs[2]!.setValue("https://example.com/og.png");

      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(createLink).toHaveBeenCalledWith(
        expect.objectContaining({
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "launch",
          ogTitle: "Ein Titel",
          ogDescription: "Eine Beschreibung",
          ogImageUrl: "https://example.com/og.png",
        }),
      );
    });

    it("after a successful create the new row shows the UTM and OG badges immediately, without a reload", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([]);
      createLink.mockResolvedValue(
        makeLink({
          id: "new1",
          domainId: "d1",
          slug: "neu1",
          utmSource: "newsletter",
          ogTitle: "Ein Titel",
        }),
      );

      const { wrapper } = await mountLinksView();

      await wrapper.find(".primary-button").trigger("click");
      await flushPromises();
      await wrapper.find(".field-input.mono").setValue("https://example.com/n");
      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      const badges = wrapper.find(".cell-slug").findAll(".attr-badge");
      expect(badges.map((b) => b.text())).toEqual(["UTM", "OG"]);
    });

    it("editing a link opens the modal with all six fields pre-filled from the link's DTO", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([
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
      ]);

      const { wrapper } = await mountLinksView();

      await wrapper.find(".row-action[title='Bearbeiten']").trigger("click");
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

    it("clearing all six pre-filled fields and saving forwards explicit null clears to updateLink", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([
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
      ]);
      updateLink.mockResolvedValue(makeLink({ id: "l1", domainId: "d1", slug: "abc123" }));

      const { wrapper } = await mountLinksView();

      await wrapper.find(".row-action[title='Bearbeiten']").trigger("click");
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

    it("a failed create carrying the OG-image-url-invalid code renders the locked message beneath the image-URL input inside the still-open modal", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([]);
      createLink.mockRejectedValue(new ApiError(400, "Bad Request", "OG_IMAGE_URL_INVALID"));

      const { wrapper } = await mountLinksView();

      await wrapper.find(".primary-button").trigger("click");
      await flushPromises();
      await wrapper.find(".field-input.mono").setValue("https://example.com/n");
      await wrapper.find(".accordion-header--og").trigger("click");
      await wrapper.findAll(".og-input")[2]!.setValue("javascript:alert(1)");

      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(wrapper.find(".modal-dialog").exists()).toBe(true);
      expect(wrapper.find(".accordion-body--og .field-error").text()).toBe(
        "Bitte eine vollständige Bild-URL mit http:// oder https:// angeben.",
      );
    });

    it("a failed edit carrying the UTM-value-too-long code renders the locked message beneath the UTM inputs inside the still-open modal", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([
        makeLink({ id: "l1", domainId: "d1", slug: "abc123" }),
      ]);
      updateLink.mockRejectedValue(new ApiError(400, "Bad Request", "UTM_VALUE_TOO_LONG"));

      const { wrapper } = await mountLinksView();

      await wrapper.find(".row-action[title='Bearbeiten']").trigger("click");
      await flushPromises();
      await wrapper.find(".accordion-header--utm").trigger("click");
      await wrapper.findAll(".utm-input")[0]!.setValue("a-very-long-utm-source-value");

      await wrapper.find(".btn-primary").trigger("click");
      await flushPromises();

      expect(wrapper.find(".modal-dialog").exists()).toBe(true);
      expect(wrapper.find(".accordion-body--utm .field-error").text()).toBe(
        "Maximal 200 Zeichen pro UTM-Wert.",
      );
    });

    it("a row with only UTM values shows only the UTM badge", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([
        makeLink({ id: "l1", domainId: "d1", slug: "abc123", utmCampaign: "launch" }),
      ]);

      const { wrapper } = await mountLinksView();

      const badges = wrapper.find(".cell-slug").findAll(".attr-badge");
      expect(badges.map((b) => b.text())).toEqual(["UTM"]);
    });

    it("a row with only OG values shows only the OG badge", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([
        makeLink({ id: "l1", domainId: "d1", slug: "abc123", ogDescription: "hallo" }),
      ]);

      const { wrapper } = await mountLinksView();

      const badges = wrapper.find(".cell-slug").findAll(".attr-badge");
      expect(badges.map((b) => b.text())).toEqual(["OG"]);
    });

    it("shows UTM before OG before the Tracking-aus badge when a link carries all three (locked order)", async () => {
      listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
      listLinks.mockResolvedValue([
        makeLink({
          id: "l1",
          domainId: "d1",
          slug: "abc123",
          trackingEnabled: false,
          utmSource: "newsletter",
          ogTitle: "Ein Titel",
        }),
      ]);

      const { wrapper } = await mountLinksView();

      const badges = wrapper.find(".cell-slug").findAll(".attr-badge");
      expect(badges.map((b) => b.text())).toEqual(["UTM", "OG", "Tracking aus"]);
    });
  });
});
