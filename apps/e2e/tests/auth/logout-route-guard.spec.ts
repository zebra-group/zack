import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { PrismaClient } from "@kurzly/api/prisma-client";
import { createE2ePrisma } from "../../src/db.js";
import { createAllowlistedUser } from "../../src/users.js";
import { findMagicLinkUrl } from "../../src/mailpit.js";

/**
 * AUTH-E2E-06 (13-05-PLAN.md) — proves the LOGOUT half of the session
 * lifecycle, complementing Phase 11's `storage-state.spec.ts` (which only
 * proves the FORWARD direction: an authenticated session reaching an
 * authenticated route). This spec proves the reverse:
 *
 *  Part 1 — clicking the sidebar `Abmelden` button (`AppShell.vue`'s
 *  `handleLogout`: `authSession.signOut()` -> `POST /api/auth/sign-out`,
 *  then `router.push({ name: "login" })`) both lands the user on `/login`
 *  AND revokes the session SERVER-SIDE — `GET /api/auth/get-session`
 *  independently returns no user afterward (T-02-13: the httpOnly cookie
 *  is the actual security boundary, a client-side redirect alone proves
 *  nothing).
 *
 *  Part 2 — a completely fresh, cookie-less browser context (no
 *  `storageState`) visiting a `requiresAuth` route (`/`, and `/links` to
 *  show the guard is route-meta-driven, not path-specific) is redirected
 *  to `/login` by `router/index.ts`'s `beforeEach` guard. This guard is a
 *  UX convenience only (T-02-14) — every API route independently
 *  re-verifies the session regardless.
 *
 * Establishes its own session inline (a dedicated, never-reused
 * `logout-<random>@e2e.kurzly.local` allowlisted user via a real magic-link
 * round trip, mirroring `magic-link-round-trip.spec.ts`) rather than relying
 * on the `setup` project's `storageState`, since this spec runs under the
 * standalone `auth` project (13-02-PLAN.md) with no `dependencies: ["setup"]`.
 */
test.describe("AUTH-E2E-06: logout ends the session; unauthenticated access redirects to /login", () => {
  let prisma: PrismaClient;
  const email = `logout-${randomUUID().slice(0, 8)}@e2e.kurzly.local`;

  test.beforeAll(async () => {
    prisma = createE2ePrisma();
    await createAllowlistedUser(prisma, { email });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("clicking Abmelden logs out server-side, and a fresh unauthenticated context is redirected to /login", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    // Establish a real session inline (INFRA-06 bypass header, mirroring
    // auth.setup.ts / magic-link-round-trip.spec.ts exactly) — never depend
    // on the setup project's storageState.
    const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    const magicLinkResponse = await request.post("/api/auth/sign-in/magic-link", {
      data: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
      headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
    });
    expect(magicLinkResponse.ok()).toBeTruthy();

    const magicLinkUrl = await findMagicLinkUrl(email);
    await page.goto(magicLinkUrl);
    await page.getByRole("link", { name: "Dashboard" }).waitFor();

    // --- Part 1: logout ---
    await page.getByTitle("Abmelden").click();
    await expect(page).toHaveURL("/login");

    // Independently prove the server session is gone — the httpOnly cookie
    // was revoked by POST /api/auth/sign-out, not merely hidden client-side.
    const sessionAfterLogout = await page.request.get("/api/auth/get-session", {
      headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
    });
    expect(sessionAfterLogout.ok()).toBeTruthy();
    expect(await sessionAfterLogout.json()).toBeNull();

    // --- Part 2: unauthenticated route-guard redirect, from a genuinely
    // cold client (no storageState, no cookie jar shared with the test's
    // own page above) ---
    const resolvedBaseUrl = baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
    const freshContext = await browser.newContext({ baseURL: resolvedBaseUrl });
    try {
      const freshPage = await freshContext.newPage();

      await freshPage.goto("/");
      await expect(freshPage).toHaveURL("/login");

      // A second requiresAuth route (route-meta-driven, not path-specific).
      await freshPage.goto("/links");
      await expect(freshPage).toHaveURL("/login");
    } finally {
      await freshContext.close();
    }
  });
});
