/**
 * Component test for AppShell (09-UI-SPEC.md Layout Contract — Surface A,
 * UI-09-01) — asserts the "Team" nav entry renders only for an
 * `accountRole: "admin"` session user and is hidden for `"member"`, while
 * the other five entries always render. Seeds `authSession.user` directly
 * (no `../api` mocking needed — the store is populated synchronously, not
 * via `fetchSession()`), mirroring the lightweight-router mount shape used
 * by `QrCodesView.test.ts`/`LinksView.test.ts`.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { SessionUser } from "@zack/shared";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AppShell from "./AppShell.vue";
import { useAuthSessionStore } from "../stores/authSession";

const { getVersion } = vi.hoisted(() => ({ getVersion: vi.fn() }));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, getVersion };
});

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return { id: "u1", email: "user@example.com", accountRole: "member", ...overrides };
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "dashboard", component: { template: "<div />" } },
      { path: "/links", name: "links", component: { template: "<div />" } },
      { path: "/qr-codes", name: "qr-codes", component: { template: "<div />" } },
      { path: "/analytics", name: "analytics", component: { template: "<div />" } },
      { path: "/domains", name: "domains", component: { template: "<div />" } },
      { path: "/team", name: "team", component: { template: "<div />" } },
      { path: "/login", name: "login", component: { template: "<div />" } },
    ],
  });
}

async function mountShell(user: SessionUser) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = makeRouter();
  await router.push("/");
  await router.isReady();

  const authSession = useAuthSessionStore();
  authSession.user = user;

  const wrapper = mount(AppShell, { global: { plugins: [router, pinia] } });
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(() => {
  getVersion.mockReset();
  getVersion.mockResolvedValue({ version: "1.0.0" });
});

describe("AppShell nav (UI-09-01)", () => {
  it("renders the Team nav entry for an admin session user", async () => {
    const wrapper = await mountShell(makeUser({ accountRole: "admin" }));

    const labels = wrapper.findAll(".nav-item").map((el) => el.text());
    expect(labels).toContain("Team");
  });

  it("hides the Team nav entry for a member session user", async () => {
    const wrapper = await mountShell(makeUser({ accountRole: "member" }));

    const labels = wrapper.findAll(".nav-item").map((el) => el.text());
    expect(labels).not.toContain("Team");
  });

  it("always renders the other five nav entries regardless of role", async () => {
    const wrapper = await mountShell(makeUser({ accountRole: "member" }));

    const labels = wrapper.findAll(".nav-item").map((el) => el.text());
    expect(labels).toEqual(["Dashboard", "Links", "QR-Codes", "Analytics", "Domains"]);
  });
});

/**
 * Regression: the sidebar footer used to hardcode "v0.1.0 · self-hosted" —
 * a literal that never matched the actual deployed release. It now fetches
 * `GET /api/version` (apps/api/src/routes/version.ts) instead.
 */
describe("AppShell version footer", () => {
  it("renders the fetched version instead of a hardcoded literal", async () => {
    getVersion.mockResolvedValue({ version: "1.2.3" });
    const wrapper = await mountShell(makeUser());
    await flushPromises();

    expect(wrapper.text()).toContain("v1.2.3 · self-hosted");
  });

  it("falls back to plain 'self-hosted' (no version segment) when the fetch fails", async () => {
    getVersion.mockRejectedValue(new Error("network error"));
    const wrapper = await mountShell(makeUser());
    await flushPromises();

    const footer = wrapper.find(".version-text");
    expect(footer.text()).toBe("self-hosted");
  });
});
