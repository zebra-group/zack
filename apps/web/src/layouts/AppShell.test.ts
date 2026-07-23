/**
 * Component test for AppShell (09-UI-SPEC.md Layout Contract — Surface A,
 * UI-09-01) — asserts the "Team" nav entry renders only for an
 * `accountRole: "admin"` session user and is hidden for `"member"`, while
 * the other five entries always render. Seeds `authSession.user` directly
 * (no `../api` mocking needed — the store is populated synchronously, not
 * via `fetchSession()`), mirroring the lightweight-router mount shape used
 * by `QrCodesView.test.ts`/`LinksView.test.ts`.
 */
import { mount } from "@vue/test-utils";
import type { SessionUser } from "@kurzly/shared";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AppShell from "./AppShell.vue";
import { useAuthSessionStore } from "../stores/authSession";

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
