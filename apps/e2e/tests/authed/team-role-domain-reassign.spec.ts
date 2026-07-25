import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { createE2eLink } from "../../src/links.js";
import { createAllowlistedUser } from "../../src/users.js";
import { findMagicLinkUrl } from "../../src/mailpit.js";

/**
 * TEAM-E2E-02 (17-02-PLAN.md) — proves an admin's REAL role/domain
 * reassignment takes effect in the affected member's OWN ALREADY-OPEN
 * browser session, with NO re-login, on its very next navigation.
 *
 * 17-RESEARCH.md Pattern 2 (code-verified this session, cross-checked
 * against `createAuth()`'s session config and `node_modules/better-auth`'s
 * own installed source): this app never sets `cookieCache`, so EVERY
 * `getSession()` call falls through to a live, uncached Postgres read
 * (`internalAdapter.findSession`) — and `scopedDomainIds`/`accountRole`
 * (`lib/authorization.ts`) are likewise re-derived fresh on every request.
 * A page reload/re-navigation is therefore structurally SUFFICIENT to
 * observe a reassignment take effect; no explicit session/token refresh
 * exists or is needed.
 *
 * PART A proves domain reassignment via a concrete, resource-scoped
 * transition: a baseline-domain `/links/:id` renders `.not-found-card`
 * (404 IDOR guard, `resolveOwnedLink`) BEFORE the member has the domain,
 * then the full link detail AFTER the admin assigns it through the REAL
 * `AssignDomainsModal` — observed on the member's own already-open context,
 * never via a `LinksView` empty-list check (ambiguous, 17-RESEARCH.md
 * Anti-Patterns) and never via a member logout/re-login (would trivially
 * prove a fresh login, not the interesting per-request re-derivation).
 *
 * PART B proves role promotion (`accountRole` re-derivation): the SAME
 * member, still on the SAME already-open context, reaches the admin-gated
 * `/team` route (and its `GET /api/team` 200) on its next navigation after
 * a real admin `.role-select` promotion — no re-login there either.
 *
 * The target is a brand-new member (`createAllowlistedUser`, zero
 * `DomainMembership` rows, per-test crypto-unique email) — NEVER the seeded
 * `ADMIN_EMAIL`/`MEMBER_EMAIL` baseline fixtures other specs' `storageState`
 * depends on (Pitfall 3, LAST_ADMIN lockout guard risk).
 */
test.describe("TEAM-E2E-02: admin's role/domain reassignment reaches the member's own re-navigated session", () => {
  // Mirrors qr-dynamic-remap.spec.ts's/team-invite-accept.spec.ts's
  // precedent: fixtures (a fresh member + a fixture Link) and a
  // multi-step admin<->member handoff straddle db-isolation.spec.ts's
  // concurrent cross-file truncates, all created OUTSIDE withResetDbLock. A
  // whole-test retry with fresh per-test unique email/slug is the
  // collision-free equivalent of fetchWithFixtureRaceRetry for a spec this
  // shaped.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    // TEAM-E2E-02's admin actions (AssignDomainsModal, role <select>)
    // require the admin-only /team surface — the member's own session is
    // established inline in a SECOND browser context, not the
    // chromium-member storageState.
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "TEAM-E2E-02 is admin-scoped; the affected member's own session is established inline in a second context",
    );

    if (testInfo.retry > 0) {
      console.warn(
        `[team-role-domain-reassign.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("admin's domain then role reassignment takes effect in the member's own re-navigated session", async ({
    page,
    browser,
    baseURL,
  }) => {
    const hex = randomUUID().slice(0, 8);
    const memberEmail = `reassign-${hex}@e2e.kurzly.local`;
    const slug = `e2e-reassign-${hex}`;

    const prisma = createE2ePrisma();
    let memberCtx: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let member: Awaited<ReturnType<typeof createAllowlistedUser>> | undefined;
    let link: Awaited<ReturnType<typeof createE2eLink>> | undefined;
    try {
      // --- SETUP: a brand-new, zero-domain active member + a baseline-
      // domain fixture Link (the specific resource whose visibility flips). ---
      member = await createAllowlistedUser(prisma, { email: memberEmail });
      link = await createE2eLink(prisma, {
        slug,
        targetUrl: `https://example.com/reassign-target-${hex}`,
      });

      // --- Establish the member's OWN real session in a SECOND, cookie-
      // less browser context (magic-link round trip, INFRA-06 bypass header
      // on the POST — never the chromium-member storageState, never a
      // cookie-injection trick). `storageState: undefined` is REQUIRED here
      // (not merely defensive): `chromium-admin`'s project config declares
      // `use.storageState`, and — empirically confirmed live this session —
      // `browser.newContext()` inherits that project default UNLESS
      // explicitly overridden, silently carrying the ADMIN's session cookie
      // into what looks like a fresh context. With that cookie present,
      // better-auth's CSRF guard (`origin-check.mjs`'s `validateOrigin`)
      // requires a matching `Origin` header on any cookie-bearing
      // state-changing request and rejects a bare POST with
      // `403 MISSING_OR_NULL_ORIGIN` — a cookie-less context never triggers
      // that guard at all, matching every prior phase's magic-link-
      // establishment pattern (none of which ran under a storageState-
      // bearing project). ---
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

      // === PART A: domain reassignment — the core proof ===

      // --- BEFORE: the zero-domain member cannot see the baseline-domain
      // link — a 404 IDOR guard (resolveOwnedLink), rendered as
      // `.not-found-card`. ---
      await memberPage.goto(`/links/${link.id}`);
      await expect(memberPage.locator(".not-found-card")).toBeVisible();
      await expect(memberPage.getByText("Link nicht gefunden")).toBeVisible();

      // --- Admin (context A) assigns the baseline domain via the REAL
      // AssignDomainsModal. ---
      await page.goto("/team");
      const memberRow = page.locator(".table-row", {
        has: page.locator(".user-email", { hasText: memberEmail }),
      });
      await expect(memberRow).toBeVisible();
      await memberRow.locator(".assign-pill").click();

      const domainPill = page.locator(".domain-pill", { hasText: BASELINE_DOMAIN_HOSTNAME });
      await expect(domainPill).toBeVisible();
      await domainPill.click();

      const [assignPut] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === "PUT" &&
            new URL(r.url()).pathname.startsWith("/api/team/") &&
            new URL(r.url()).pathname.endsWith("/domains"),
        ),
        page.locator(".btn-primary", { hasText: "Speichern" }).click(),
      ]);
      expect(assignPut.ok()).toBe(true);

      await expect(memberRow.locator(".domain-chip", { hasText: BASELINE_DOMAIN_HOSTNAME })).toBeVisible();

      // --- AFTER: the SAME member context, NO re-login, re-navigates the
      // SAME link — the reassignment reached the already-open session on
      // its very next request. ---
      await memberPage.goto(`/links/${link.id}`);
      await expect(memberPage.locator(".not-found-card")).toHaveCount(0);
      await expect(memberPage.locator(".link-slug")).toHaveText(`/${slug}`);

      // === PART B: role promotion — accountRole re-derivation ===

      const [rolePatch] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === "PATCH" &&
            new URL(r.url()).pathname.startsWith("/api/team/") &&
            new URL(r.url()).pathname.endsWith("/role"),
        ),
        memberRow.locator(".role-select").selectOption("admin"),
      ]);
      expect(rolePatch.ok()).toBe(true);

      // --- On the SAME memberPage, still no re-login: /team now admits it
      // (requiresAdmin guard) and GET /api/team independently 200s. ---
      await memberPage.goto("/team");
      await expect(memberPage).not.toHaveURL(/\/(login|dashboard)$/);
      await expect(memberPage.locator(".table-header")).toBeVisible();

      const teamApiResponse = await memberPage.request.get("/api/team");
      expect(teamApiResponse.ok()).toBeTruthy();
    } finally {
      if (memberCtx) await memberCtx.close();
      // Teardown (WR-01, 17-REVIEW.md): this spec's own test subject is
      // promoted to `accountRole: "admin"` with a live DomainMembership on
      // the baseline domain by PART B above — the highest-hygiene-cost
      // leaked fixture in this phase (a permanently-privileged real admin
      // row surviving for the rest of the compose session). Delete it
      // (schema.prisma cascades DomainMembership/Session/Account) and the
      // fixture Link this spec created, so neither accumulates across runs.
      // Never touches the seeded ADMIN_EMAIL/MEMBER_EMAIL baseline fixtures.
      if (link) await prisma.link.delete({ where: { id: link.id } });
      if (member) await prisma.user.delete({ where: { id: member.id } });
      await prisma.$disconnect();
    }
  });
});
