import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createE2ePrisma } from "../../src/db.js";
import { findMagicLinkUrl } from "../../src/mailpit.js";

/**
 * TEAM-E2E-01 (17-01-PLAN.md) — proves the invite-only team lifecycle's
 * invite half end to end through the REAL Team management UI: an admin
 * invites a brand-new member (`InviteMemberModal` -> `POST /api/team/invite`),
 * the new roster row appears immediately as "Ausstehend" (pending), a
 * SEPARATE fresh (unauthenticated) browser context retrieves the invite
 * email via Mailpit and accepts it by opening the magic link, and the
 * admin's re-navigated Team list flips that SAME row's status badge to
 * "Aktiv" (active) — cross-checked against a direct-Prisma read confirming
 * `emailVerified: true`.
 *
 * 17-RESEARCH.md Pattern 1 (code-verified this session): `lib/team.ts`'s
 * `inviteMember` calls `auth.api.signInMagicLink` verbatim — the EXACT SAME
 * better-auth mechanism the login flow's own magic-link send uses. There is
 * no separate invite-token table or route, so Phase 11's `findMagicLinkUrl`
 * (recipient-scoped, hard-asserts the `To` address — T-11-07) retrieves the
 * invite email completely unchanged.
 */
test.describe("TEAM-E2E-01: admin invites a new member via the real Team UI; magic-link acceptance flips the roster status", () => {
  // Mirrors qr-dynamic-remap.spec.ts's/links-crud.spec.ts's precedent: the
  // full-suite phase gate runs db-isolation.spec.ts's concurrent truncates
  // alongside this multi-step (invite -> Mailpit -> accept -> re-fetch)
  // journey. A whole-test retry with a fresh per-test crypto-unique invitee
  // email is the collision-free equivalent of fetchWithFixtureRaceRetry for
  // a spec this shaped (17-RESEARCH.md Sampling Rate).
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    // TEAM-E2E-01's invite actions require the admin-only /team surface —
    // the invitee's own acceptance session is established inline in a
    // fresh browser context, not the chromium-member storageState.
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "TEAM-E2E-01 is admin-scoped; the invitee's own session is established inline in a fresh context",
    );

    if (testInfo.retry > 0) {
      console.warn(
        `[team-invite-accept.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("admin invites a new member; acceptance via magic link flips the roster status Ausstehend -> Aktiv", async ({
    page,
    browser,
    baseURL,
  }) => {
    const hex = randomUUID().slice(0, 8);
    const inviteeEmail = `team-invite-${hex}@e2e.kurzly.local`;

    // --- Step 1: real-UI invite send (chromium-admin, already authenticated
    // via storageState — no login needed) ---
    await page.goto("/team");
    await page.locator(".team-table .table-row").first().waitFor();

    await page.locator(".invite-button").click();
    await page.locator(".field-input").fill(inviteeEmail);
    // Role stays the default "member" (no role-card click needed) — a
    // pending member with zero domains keeps the assertion focused on the
    // status flip, per 17-01-PLAN.md's own scoping.

    const [invitePost] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/team/invite",
      ),
      page.locator(".btn-primary").click(),
    ]);
    expect(invitePost.status()).toBe(201);

    // --- Step 2 (BEFORE-acceptance assertion): the new row appears
    // immediately, status "Ausstehend" (NOT `.active`) — proves the invite
    // send + optimistic list append (TEAM-01/D-09-04). ---
    const row = page.locator(".table-row", {
      has: page.locator(".user-email", { hasText: inviteeEmail }),
    });
    await expect(row).toBeVisible();
    const statusBadgeBefore = row.locator(".status-badge");
    await expect(statusBadgeBefore).toHaveText("Ausstehend");
    await expect(statusBadgeBefore).not.toHaveClass(/active/);

    // --- Step 3: acceptance in a SEPARATE, fresh unauthenticated browser
    // context — findMagicLinkUrl retrieves the invite email (an ordinary
    // magic-link email, recipient-scoped, T-11-07) and fully navigates the
    // returned URL, which resolves better-auth's verify handler
    // (emailVerified:true write + Session creation) BEFORE the admin's
    // re-fetch (Pitfall 2: never race the two contexts). ---
    const magicLinkUrl = await findMagicLinkUrl(inviteeEmail);

    // `storageState: undefined` is REQUIRED here (not merely defensive,
    // CR-01 17-REVIEW.md): this test only ever runs under `chromium-admin`
    // (test.skip above), whose project config declares `use.storageState`,
    // and `browser.newContext()` otherwise silently inherits the ADMIN's
    // session cookie into what looks like a fresh, unauthenticated context
    // — 17-02's documented fix (`team-role-domain-reassign.spec.ts`),
    // applied consistently across every other spec in this phase.
    const resolvedBaseUrl = baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
    const acceptCtx = await browser.newContext({ baseURL: resolvedBaseUrl, storageState: undefined });
    try {
      const acceptPage = await acceptCtx.newPage();
      await acceptPage.goto(magicLinkUrl);
      // Fully resolves the acceptance navigation (including better-auth's
      // post-verify redirect) before proceeding — the authenticated App
      // Shell rendering is the concrete "acceptance fully completed" signal.
      await acceptPage.getByRole("link", { name: "Dashboard" }).waitFor();
    } finally {
      await acceptCtx.close();
    }

    // --- Step 4 (AFTER-acceptance assertion): the admin re-navigates /team
    // so listTeamMembers re-reads fresh from the DB; the SAME row now reads
    // "Aktiv" (`.active` class present) — the emailVerified-driven status
    // flip, the strongest available end-to-end proof. ---
    await page.goto("/team");
    const rowAfter = page.locator(".table-row", {
      has: page.locator(".user-email", { hasText: inviteeEmail }),
    });
    const statusBadgeAfter = rowAfter.locator(".status-badge");
    await expect(statusBadgeAfter).toHaveText("Aktiv");
    await expect(statusBadgeAfter).toHaveClass(/active/);

    // --- Step 5: direct-Prisma cross-check — emailVerified === true. ---
    const prisma = createE2ePrisma();
    try {
      const invitee = await prisma.user.findUniqueOrThrow({ where: { email: inviteeEmail } });
      expect(invitee.emailVerified).toBe(true);

      // Teardown (WR-01, 17-REVIEW.md): this spec creates a real invitee
      // User row via the real invite-accept flow, and withResetDbLock never
      // truncates User. Delete it (schema.prisma cascades its Session —
      // created by the magic-link acceptance — and any Account/
      // DomainMembership, none of which exist here) so it doesn't
      // accumulate across runs within the same compose session. Never
      // touches the seeded ADMIN_EMAIL/MEMBER_EMAIL baseline fixtures.
      await prisma.user.delete({ where: { id: invitee.id } });
    } finally {
      await prisma.$disconnect();
    }
  });
});
