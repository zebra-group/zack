import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createE2ePrisma } from "../../src/db.js";
import { createAllowlistedUser } from "../../src/users.js";
import { findMagicLinkUrl } from "../../src/mailpit.js";

/**
 * TEAM-E2E-03 (17-03-PLAN.md) — proves an admin's REAL member removal
 * (via the Team management UI) immediately revokes the removed member's
 * active session: their OWN already-open browser context's VERY NEXT
 * request (no polling, no wait, no retry-until-eventually-consistent)
 * already observes the session as gone.
 *
 * 17-RESEARCH.md Pattern 2 (code-verified this session, cross-checked
 * against `createAuth()`'s session config and `node_modules/better-auth`'s
 * own installed source, plus `schema.prisma`'s `Session.user onDelete:
 * Cascade` FK and `lib/team.ts`'s `removeMember`): this app never sets
 * `cookieCache`, so EVERY `getSession()` call falls through to a live,
 * uncached Postgres read (`internalAdapter.findSession`) — and
 * `removeMember`'s single `tx.user.delete(...)` cascade-deletes every
 * `Session` row for that user INSIDE THE SAME TRANSACTION as the User
 * delete. There is therefore no TTL/eventual-consistency gap to test
 * around: the "immediate" claim is what the code actually does, not an
 * aspiration — this spec asserts on the FIRST subsequent request only
 * (17-RESEARCH.md Anti-Patterns: a polling/retry loop would test a
 * WEAKER, wrong claim).
 *
 * The proof is threefold: (1) `GET /api/auth/get-session` returns `null`
 * on the member's old context's very next call (API boundary), (2) a
 * `/links` navigation on that SAME context redirects to `/login` (UI
 * route-guard boundary), and (3) a direct-Prisma cross-check confirms
 * BOTH the `User` row and every `Session` row for that userId are gone
 * (DB boundary — the schema-level cascade IS the revocation mechanism).
 *
 * The target is a brand-new, zero-domain active member
 * (`createAllowlistedUser`, per-test crypto-unique email) — NEVER the
 * seeded `ADMIN_EMAIL`/`MEMBER_EMAIL` baseline fixtures other specs'
 * `storageState` depends on, and never the sole admin (Pitfall 3,
 * `LAST_ADMIN` lockout guard risk, T-17-03-LOCKOUT).
 *
 * Establishes the member's own session exactly as 17-02-PLAN.md's
 * `team-role-domain-reassign.spec.ts` fixed it: `browser.newContext()`
 * under a storageState-bearing project (`chromium-admin`) silently
 * inherits that project's default `storageState` unless explicitly
 * overridden with `storageState: undefined`, and the magic-link sign-in
 * POST must be issued via that context's own `.request` (never the
 * top-level `request` fixture, which is likewise storageState-bound) to
 * avoid tripping better-auth's CSRF `MISSING_OR_NULL_ORIGIN` guard.
 */
test.describe("TEAM-E2E-03: removing a member immediately revokes their active session", () => {
  // Mirrors qr-dynamic-remap.spec.ts's/team-invite-accept.spec.ts's/
  // team-role-domain-reassign.spec.ts's precedent: this spec's fixture (a
  // fresh member, created outside withResetDbLock) straddles
  // db-isolation.spec.ts's concurrent cross-file truncate race. A
  // whole-test retry with a fresh per-test crypto-unique email is the
  // collision-free equivalent of fetchWithFixtureRaceRetry for a spec
  // this shaped.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    // TEAM-E2E-03's removal action requires the admin-only /team surface —
    // the member's own session is established inline in a SECOND browser
    // context, not the chromium-member storageState.
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "TEAM-E2E-03 is admin-scoped; the removed member's own session is established inline in a second context",
    );

    if (testInfo.retry > 0) {
      console.warn(
        `[team-member-removal.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("removing a member immediately revokes their active session on the very next request", async ({
    page,
    browser,
    baseURL,
  }) => {
    const hex = randomUUID().slice(0, 8);
    const memberEmail = `removal-${hex}@e2e.zack.local`;

    const prisma = createE2ePrisma();
    let memberCtx: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      // --- SETUP: a brand-new, active member (never the seeded fixtures,
      // never the sole admin — Pitfall 3 / LAST_ADMIN). ---
      const member = await createAllowlistedUser(prisma, { email: memberEmail });

      // --- Establish the member's OWN real session in a SECOND, cookie-
      // less browser context (magic-link round trip). `storageState:
      // undefined` is REQUIRED (17-02's discovered fix): chromium-admin's
      // project config declares `use.storageState`, and
      // `browser.newContext()` otherwise silently inherits the ADMIN's
      // session cookie into what looks like a fresh context, tripping
      // better-auth's CSRF guard on the magic-link POST. ---
      const resolvedBaseUrl = baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
      memberCtx = await browser.newContext({ baseURL: resolvedBaseUrl, storageState: undefined });

      const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
      const magicLinkResponse = await memberCtx.request.post("/api/auth/sign-in/magic-link", {
        data: { email: memberEmail, callbackURL: "/", errorCallbackURL: "/auth/error" },
        headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
      });
      expect(magicLinkResponse.ok()).toBeTruthy();

      const magicLinkUrl = await findMagicLinkUrl(memberEmail);
      const memberPage = await memberCtx.newPage();
      await memberPage.goto(magicLinkUrl);
      await memberPage.getByRole("link", { name: "Dashboard" }).waitFor();

      // --- BEFORE: prove the member's session is genuinely live before
      // removal — get-session returns { user: { email } }. ---
      const before = await memberPage.request.get("/api/auth/get-session");
      expect(before.ok()).toBeTruthy();
      const beforeBody = (await before.json()) as { user?: { email?: string } } | null;
      expect(beforeBody?.user?.email).toBe(memberEmail);

      // --- REMOVAL via the REAL Team UI (admin `page`, context A). ---
      await page.goto("/team");
      const memberRow = page.locator(".table-row", {
        has: page.locator(".user-email", { hasText: memberEmail }),
      });
      await expect(memberRow).toBeVisible();

      await memberRow.locator(".menu-cell").click();
      await memberRow.locator(".action-menu-item").click();

      const deleteDialog = page.locator(".delete-dialog");
      await expect(deleteDialog).toBeVisible();

      const [deleteResp] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === "DELETE" &&
            new URL(r.url()).pathname === `/api/team/${member.id}`,
        ),
        page.locator(".delete-confirm-button").click(),
      ]);
      expect(deleteResp.status()).toBe(204);

      // Admin roster reflects the removal — the row is gone.
      await expect(memberRow).toHaveCount(0);

      // --- AFTER: the member's OLD context B, on its VERY NEXT request
      // (no polling, no wait) — the session row is already gone. This is
      // the immediate-revocation crux. ---
      const after = await memberPage.request.get("/api/auth/get-session");
      expect(after.ok()).toBeTruthy();
      expect(await after.json()).toBeNull();

      // A dashboard navigation now bounces to /login — the route guard
      // catches the now-sessionless context on its next navigation too.
      await memberPage.goto("/links");
      await expect(memberPage).toHaveURL("/login");

      // --- DB cross-check: both the User row and every Session row for
      // that userId are gone — the schema-level cascade IS the revocation
      // mechanism. ---
      const userCount = await prisma.user.count({ where: { id: member.id } });
      expect(userCount).toBe(0);
      const sessionCount = await prisma.session.count({ where: { userId: member.id } });
      expect(sessionCount).toBe(0);
    } finally {
      if (memberCtx) await memberCtx.close();
      await prisma.$disconnect();
    }
  });
});
