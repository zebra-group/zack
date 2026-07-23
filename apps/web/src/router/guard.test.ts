/**
 * Router guard test (UI-09-01) — exercises the `requiresAdmin` branch added
 * to the real `beforeEach` guard against the actual default-exported
 * `router` singleton (not a duplicate/parallel guard implementation), so a
 * regression in `router/index.ts` is actually caught here. Navigation is
 * driven headlessly via `router.push()` + `router.currentRoute` — no
 * component is ever mounted, so no view's data-loading side effects run.
 * `authSession.user` is seeded truthy before every push, so the guard's
 * `fetchSession()` branch (real network) never triggers.
 */
import type { SessionUser } from "@kurzly/shared";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import router from "./index";
import { useAuthSessionStore } from "../stores/authSession";

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return { id: "u1", email: "user@example.com", accountRole: "member", ...overrides };
}

describe("router requiresAdmin guard (UI-09-01)", () => {
  it("redirects a signed-in member navigating to /team to the dashboard", async () => {
    setActivePinia(createPinia());
    const authSession = useAuthSessionStore();
    authSession.user = makeUser({ accountRole: "member" });

    await router.push({ name: "team" });

    expect(router.currentRoute.value.name).toBe("dashboard");
  });

  it("lets a signed-in admin through to /team", async () => {
    setActivePinia(createPinia());
    const authSession = useAuthSessionStore();
    authSession.user = makeUser({ accountRole: "admin" });

    await router.push({ name: "team" });

    expect(router.currentRoute.value.name).toBe("team");
  });
});
