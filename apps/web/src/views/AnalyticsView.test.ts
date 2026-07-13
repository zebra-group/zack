/**
 * Component test for AnalyticsView (06-UI-SPEC.md § Surface B, TRACK-05).
 * Mocks `../api`; uses a lightweight test router (own route table, no auth
 * guard) so `router.push` navigation from a clicked Top-Links row resolves
 * without a real session — mirrors LinkDetailView.test.ts's pattern.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { GlobalAnalyticsDTO } from "@kurzly/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AnalyticsView from "./AnalyticsView.vue";

const { getGlobalAnalytics } = vi.hoisted(() => ({
  getGlobalAnalytics: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, getGlobalAnalytics };
});

function makeAnalytics(overrides: Partial<GlobalAnalyticsDTO> = {}): GlobalAnalyticsDTO {
  return {
    clicks30Days: 0,
    uniqueVisitors: 0,
    activeLinks: 0,
    qrScans: 0,
    dailySeries: Array.from({ length: 30 }, (_, i) => ({
      day: `2026-06-${String(i + 1).padStart(2, "0")}`,
      count: 0,
    })),
    topLinks: [],
    topReferrers: [],
    ...overrides,
  };
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/analytics", name: "analytics", component: AnalyticsView },
      { path: "/links/:id", name: "link-detail", component: { template: "<div>detail</div>" } },
    ],
  });
}

beforeEach(() => {
  getGlobalAnalytics.mockReset();
});

async function mountAnalyticsView() {
  const router = makeRouter();
  await router.push("/analytics");
  await router.isReady();
  const wrapper = mount(AnalyticsView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe("AnalyticsView", () => {
  it("loading state: shows skeleton blocks (no spinner) while analytics fetches, never alongside data/zero-data", async () => {
    let resolveAnalytics!: (value: GlobalAnalyticsDTO) => void;
    getGlobalAnalytics.mockReturnValue(
      new Promise<GlobalAnalyticsDTO>((resolve) => {
        resolveAnalytics = resolve;
      }),
    );

    const router = makeRouter();
    await router.push("/analytics");
    await router.isReady();
    const wrapper = mount(AnalyticsView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.findAll(".skeleton-block").length).toBeGreaterThan(0);
    expect(wrapper.find(".zero-data-hint").exists()).toBe(false);
    expect(wrapper.find(".bar").exists()).toBe(false);
    expect(wrapper.find(".list-empty-row").exists()).toBe(false);

    resolveAnalytics(makeAnalytics());
    await flushPromises();

    expect(wrapper.find(".skeleton-block").exists()).toBe(false);
    expect(wrapper.find(".zero-data-hint").exists()).toBe(true);
  });

  it("data state: 4 stat cards incl QR-Scans '0', 30 chart bars, clickable Top-Links rows, Referrer list", async () => {
    getGlobalAnalytics.mockResolvedValue(
      makeAnalytics({
        clicks30Days: 120,
        uniqueVisitors: 45,
        activeLinks: 8,
        qrScans: 0,
        topLinks: [
          { id: "l1", slug: "abc123", domainId: "d1", clicks: 60 },
          { id: "l2", slug: "xyz789", domainId: "d1", clicks: 20 },
        ],
        topReferrers: [
          { host: "google.com", count: 30 },
          { host: null, count: 10 },
        ],
      }),
    );

    const { wrapper } = await mountAnalyticsView();

    expect(wrapper.find(".header-title").text()).toBe("Analytics");
    expect(wrapper.find(".header-subtitle").text()).toBe("alle Links · letzte 30 Tage");

    expect(wrapper.findAll(".stat-label").map((n) => n.text())).toEqual([
      "Klicks (30 Tage)",
      "Unique Visitors",
      "Aktive Links",
      "QR-Scans",
    ]);
    expect(wrapper.findAll(".stat-value").map((n) => n.text())).toEqual(["120", "45", "8", "0"]);

    expect(wrapper.findAll(".bar")).toHaveLength(30);

    const topLinksRows = wrapper.findAll(".top-links-row");
    expect(topLinksRows).toHaveLength(2);
    expect(topLinksRows.map((n) => n.find(".row-name-wide").text())).toEqual([
      "/abc123",
      "/xyz789",
    ]);
    expect(topLinksRows.map((n) => n.find(".row-count").text())).toEqual(["60", "20"]);

    expect(wrapper.findAll(".list-title").map((n) => n.text())).toEqual(["Top Links", "Referrer"]);
    const referrerCard = wrapper.findAll(".list-card")[1]!;
    expect(referrerCard.findAll(".row-name").map((n) => n.text())).toEqual([
      "google.com",
      "Direkt",
    ]);

    expect(wrapper.find(".zero-data-hint").exists()).toBe(false);
    expect(wrapper.find(".skeleton-block").exists()).toBe(false);
  });

  it("clicking a Top-Links row navigates to /links/:id", async () => {
    getGlobalAnalytics.mockResolvedValue(
      makeAnalytics({
        clicks30Days: 10,
        topLinks: [{ id: "l1", slug: "abc123", domainId: "d1", clicks: 10 }],
      }),
    );

    const { wrapper, router } = await mountAnalyticsView();

    await wrapper.find(".top-links-row").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("link-detail");
    expect(router.currentRoute.value.params.id).toBe("l1");
  });

  it("zero-data state: 4 stat cards with 0 EXCEPT Aktive Links (real count), chart hint, 'Keine Daten' lists", async () => {
    getGlobalAnalytics.mockResolvedValue(
      makeAnalytics({ clicks30Days: 0, uniqueVisitors: 0, activeLinks: 3, qrScans: 0 }),
    );

    const { wrapper } = await mountAnalyticsView();

    expect(wrapper.findAll(".stat-value").map((n) => n.text())).toEqual(["0", "0", "3", "0"]);
    expect(wrapper.find(".zero-data-hint").text()).toBe(
      "Noch keine Klicks erfasst — sobald Links aufgerufen werden, erscheinen hier Daten.",
    );
    expect(wrapper.findAll(".list-empty-row")).toHaveLength(2);
    expect(wrapper.findAll(".list-empty-row").every((n) => n.text() === "Keine Daten")).toBe(true);
    expect(wrapper.find(".bar").exists()).toBe(false);
  });

  it("surfaces a toast when the fetch fails", async () => {
    getGlobalAnalytics.mockRejectedValue(new Error("network error"));

    const { wrapper } = await mountAnalyticsView();

    expect(wrapper.find(".toast").text()).toBe("Analytics konnten nicht geladen werden.");
  });
});

describe("AnalyticsView router registration (/analytics)", () => {
  it("the real app router resolves /analytics to AnalyticsView (not ComingSoonView) with requiresAuth", async () => {
    const { default: router } = await import("../router/index");
    const { default: ComingSoonView } = await import("./ComingSoonView.vue");

    const match = router.resolve({ name: "analytics" });
    expect(match.meta.requiresAuth).toBe(true);
    expect(match.path).toBe("/analytics");

    const record = router.getRoutes().find((r) => r.name === "analytics");
    expect(record?.components?.default).toBe(AnalyticsView);
    expect(record?.components?.default).not.toBe(ComingSoonView);
  });
});
