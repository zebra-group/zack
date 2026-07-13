/**
 * Component test for LinkDetailView (04-UI-SPEC.md Link-Detail,
 * LINK-05/06/07, UI-06). Mocks `../api`; uses a lightweight test router
 * (own route table, no auth guard) so `route.params.id` and
 * `router.push` navigation resolve without a real session.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { DomainDTO, LinkDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import LinkDetailView from "./LinkDetailView.vue";
import { ApiError } from "../api";

const { deleteLink, getLink, listDomains, updateLink } = vi.hoisted(() => ({
  deleteLink: vi.fn(),
  getLink: vi.fn(),
  listDomains: vi.fn(),
  updateLink: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, deleteLink, getLink, listDomains, updateLink };
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
    ...overrides,
  };
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/links", name: "links", component: { template: "<div>links</div>" } },
      { path: "/links/:id", name: "link-detail", component: LinkDetailView },
    ],
  });
}

beforeEach(() => {
  deleteLink.mockReset();
  getLink.mockReset();
  listDomains.mockReset();
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

  it("shows the STATIC placeholder stats card with no analytics API call", async () => {
    listDomains.mockResolvedValue([makeDomain()]);
    getLink.mockResolvedValue(makeLink());

    const { wrapper } = await mountDetailView();

    expect(wrapper.find(".stats-heading").text()).toBe("Statistiken — bald verfügbar");
    expect(wrapper.text()).toContain("Klick-Statistiken sind noch nicht verfügbar");
  });

  it("copy composes the FULL https URL and toasts 'Link kopiert'", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    getLink.mockResolvedValue(makeLink({ domainId: "d1", slug: "abc123" }));

    const { wrapper } = await mountDetailView();

    await wrapper.find(".action-button").trigger("click");
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
    await buttons[1]!.trigger("click"); // ✎ Bearbeiten
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
    });
    expect(wrapper.text()).toContain("Änderungen gespeichert");
  });

  it("WR-09: a non-ApiError edit failure (e.g. a network error) surfaces a fallback toast instead of failing silently", async () => {
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    getLink.mockResolvedValue(
      makeLink({ id: "l1", domainId: "d1", slug: "abc123", targetUrl: "https://example.com/1" }),
    );
    updateLink.mockRejectedValue(new TypeError("Failed to fetch"));

    const { wrapper } = await mountDetailView();

    const buttons = wrapper.findAll(".action-button");
    await buttons[1]!.trigger("click"); // ✎ Bearbeiten
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
    await buttons[2]!.trigger("click"); // 🗑 Löschen
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

  it("shows a not-found state and does not crash when getLink 404s", async () => {
    listDomains.mockResolvedValue([]);
    getLink.mockRejectedValue(new ApiError(404, "Not Found"));

    const { wrapper } = await mountDetailView("missing");

    expect(wrapper.text()).toContain("Link nicht gefunden");
  });
});
