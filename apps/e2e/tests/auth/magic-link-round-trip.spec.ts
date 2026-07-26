import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma } from "../../src/db.js";
import { createAllowlistedUser } from "../../src/users.js";
import { findMagicLinkUrl } from "../../src/mailpit.js";

/**
 * AUTH-E2E-01 (13-03-PLAN.md) — proves the magic-link login round trip
 * reaches an ACTIVE, SERVER-VERIFIED session end to end: request the link
 * over real HTTP -> retrieve it from Mailpit (recipient-scoped, `mailpit.ts`)
 * -> open it in a real browser -> the authenticated App Shell renders ("Dashboard"
 * nav) -> `GET /api/auth/get-session` independently confirms the session
 * server-side (T-02-13: the session cookie/DB row is the actual security
 * boundary, the UI render is only its reflection — never assert on the UI
 * alone).
 *
 * Phase 11's `auth.setup.ts` already proves this SAME mechanic implicitly
 * (it snapshots `storageState` for the `chromium-admin`/`chromium-member`
 * projects to consume) — this spec exists to make the session assertion
 * EXPLICIT and independently verifiable, and to run under the standalone
 * `auth` Playwright project (no `dependencies: ["setup"]`, 13-02-PLAN.md),
 * since this spec IS a proof of login itself.
 *
 * Uses a DEDICATED, never-reused email (never `ADMIN_EMAIL`/`MEMBER_EMAIL`,
 * which the `setup` project's own round trip owns, nor an email any other
 * spec in this phase reuses) so this spec can never collide with another
 * project's concurrently in-flight magic-link request for the same
 * recipient — `mailpit.ts`'s cross-worker email-theft guard would otherwise
 * throw if two requests for the same address raced.
 *
 * Sends the INFRA-06 `x-e2e-bypass` header (mirroring `auth.setup.ts`
 * exactly) via the `request` fixture so this spec never contends the shared
 * IP rate-limit bucket AUTH-E2E-07 (13-06) deliberately trips.
 */
test("magic-link round trip: request -> Mailpit -> open link -> active, server-verified session (AUTH-E2E-01)", async ({
  page,
  request,
}) => {
  const email = `roundtrip-${randomUUID().slice(0, 8)}@e2e.kurzly.local`;

  const prisma = createE2ePrisma();
  try {
    await createAllowlistedUser(prisma, { email });
  } finally {
    await prisma.$disconnect();
  }

  const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  const magicLinkResponse = await request.post("/api/auth/sign-in/magic-link", {
    data: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
    headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
  });
  expect(magicLinkResponse.ok()).toBeTruthy();

  // Recipient-scoped retrieval (src/mailpit.ts) — hard-asserts the
  // retrieved message's To address equals `email` before returning a link.
  const magicLinkUrl = await findMagicLinkUrl(email);

  // Following the real link exercises the actual verify endpoint and its
  // 302 redirect to the dashboard (callbackURL: "/") — this IS the
  // authenticated session being established, not a simulated one.
  await page.goto(magicLinkUrl);

  // The authenticated App Shell actually rendered — "Dashboard" is present
  // for every role (AppShell.vue's visibleNavItems), unlike "Team" which is
  // admin-only.
  await page.getByRole("link", { name: "Dashboard" }).waitFor();

  // Independently prove the session is a SERVER-VERIFIED artifact, not just
  // a UI reflection (T-02-13): GET /api/auth/get-session (via page.request,
  // which shares the SAME BrowserContext cookie jar the goto above just
  // established) returns `{ user }` for the same email. better-auth's raw
  // response is `null` when unauthenticated, `{ session, user }` when a
  // valid session cookie is present (apps/web/src/api.ts's own documented
  // contract, confirmed against apps/api's integration test suite).
  const sessionResponse = await page.request.get("/api/auth/get-session", {
    headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const sessionBody = (await sessionResponse.json()) as { user?: { email?: string } } | null;
  expect(sessionBody?.user?.email).toBe(email);
});
