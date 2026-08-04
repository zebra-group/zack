/**
 * Router guard test (UI-09-01, UI-10-09) — exercises the `requiresAdmin`
 * branch AND the `/login?preview=1` escape hatch added to the real
 * `beforeEach` guard against the actual default-exported `router` singleton
 * (not a duplicate/parallel guard implementation), so a regression in
 * `router/index.ts` is actually caught here. Navigation is driven headlessly
 * via `router.push()` + `router.currentRoute` — no component is ever
 * mounted, so no view's data-loading side effects run. `authSession.user`
 * is seeded truthy before every authenticated-case push, so the guard's
 * `fetchSession()` branch (real network) never triggers. The unauthenticated
 * preview-guard cases below mock `../api`'s `getSession` (never previously
 * mocked in this file) so the guard's `fetchSession()` call — which DOES
 * trigger for `/login` when `user` is still null — resolves deterministically
 * instead of hitting a real network request.
 */
import type { SessionUser } from "@zack/shared";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import router from "./index";
import { useAuthSessionStore } from "../stores/authSession";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, getSession };
});

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return { id: "u1", email: "user@example.com", accountRole: "member", ...overrides };
}

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue({ user: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("router /login preview escape hatch (UI-10-09)", () => {
  it("redirects an authenticated admin navigating to plain /login to the dashboard (unchanged)", async () => {
    setActivePinia(createPinia());
    const authSession = useAuthSessionStore();
    authSession.user = makeUser({ accountRole: "admin" });

    await router.push("/login");

    expect(router.currentRoute.value.name).toBe("dashboard");
  });

  it("does NOT redirect an authenticated admin navigating to /login?preview=1 — LoginView renders", async () => {
    setActivePinia(createPinia());
    const authSession = useAuthSessionStore();
    authSession.user = makeUser({ accountRole: "admin" });

    await router.push("/login?preview=1");

    expect(router.currentRoute.value.name).toBe("login");
  });

  it("renders LoginView for an unauthenticated visitor to plain /login (unchanged)", async () => {
    setActivePinia(createPinia());

    await router.push("/login");

    expect(router.currentRoute.value.name).toBe("login");
  });

  it("renders LoginView for an unauthenticated visitor to /login?preview=1 (unchanged)", async () => {
    setActivePinia(createPinia());

    await router.push("/login?preview=1");

    expect(router.currentRoute.value.name).toBe("login");
  });
});
