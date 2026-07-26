import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma } from "../../src/db.js";
import { resetOidcProfile, setOidcProfile } from "../../src/oidc-mock.js";
import { createInvitedUnverifiedUser } from "../../src/users.js";

/**
 * SSO login (AUTH-E2E-04/05, 13-07-PLAN.md/13-08-PLAN.md) — a single
 * `test.describe.serial` block so the two SSO specs never race
 * `apps/e2e/oidc-mock`'s single global profile state (`server.mjs`'s
 * `nextProfile`, controlled via `oidc-mock.ts`'s
 * `setOidcProfile`/`resetOidcProfile`, 13-01/13-02-PLAN.md). 13-08-PLAN.md
 * appends the AUTH-E2E-05 account-merge test to this SAME block rather than
 * a second file.
 *
 * `afterEach` unconditionally resets the mock's profile back to its own
 * server-side default so neither SSO test can leak its subject/claims into
 * whichever SSO test runs next, regardless of pass/fail.
 */
test.describe.serial("SSO login (AUTH-E2E-04/05)", () => {
  test.afterEach(async () => {
    await resetOidcProfile();
  });

  /**
   * AUTH-E2E-04 — a first-time SSO user drives the REAL browser
   * authorization-code round trip against the mock IdP
   * (`apps/e2e/oidc-mock`, 13-01-PLAN.md) and lands an active,
   * server-verified session, provisioned least-privilege even when the IdP
   * feeds admin-shaped claims (`role`, `groups`, `admin`).
   * `apps/api/src/lib/auth.ts`'s `createAuth()` registers `genericOAuth`
   * with no `mapProfileToUser` and `accountRole`'s `input: false`
   * (D-10-04) — those claims can never elevate the provisioned user. The
   * existing Vitest `sso-auth.integration.test.ts` already proves this
   * server-side via a hand stub; this spec drives the SAME guarantee
   * through a real browser and the mock IdP's actual dual-reachability
   * discovery contract — the browser is redirected to the mock's
   * HOST-published `authorization_endpoint` (localhost:9000) while the
   * `app` container talks to the mock over the Docker-internal address for
   * token/userinfo (13-RESEARCH.md Architecture Patterns, Pattern 1).
   *
   * A unique, per-run `sub`/`email` (never a fixed literal) means this test
   * can never collide with AUTH-E2E-05's own subject/email or its
   * `Account(providerId, accountId)` uniqueness constraint.
   */
  test("first-time SSO login provisions least-privilege member even against admin-shaped claims (AUTH-E2E-04)", async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 8);
    const email = `sso-04-${suffix}@idp.test`;

    await setOidcProfile({
      sub: `sso-04-${suffix}`,
      email,
      extraClaims: { role: "admin", groups: ["admins", "owners"], admin: true },
    });

    await page.goto("/login");
    const ssoButton = page.getByRole("button", { name: "Mit SSO anmelden" });
    await expect(ssoButton).toBeVisible();
    await ssoButton.click();

    // The click drives a real browser redirect through the mock's
    // host-published authorization_endpoint, an auto-approved login+consent
    // interaction, and back through /api/auth/oauth2/callback/oidc to the
    // dashboard — wait on the authenticated App Shell actually rendering
    // rather than a fixed timeout (mirrors magic-link-round-trip.spec.ts's
    // own "Dashboard" nav wait).
    await page.getByRole("link", { name: "Dashboard" }).waitFor();

    // Independently confirm a SERVER-VERIFIED session — page.request shares
    // the same BrowserContext cookie jar the redirect chain just
    // established (T-02-13: the session cookie/DB row is the actual
    // security boundary, never just the UI render).
    // Narrow rate-limit bypass (INFRA-06) — see the identical rationale on
    // the other `get-session` calls in this file.
    const bypassSecretAdmin = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    const sessionResponse = await page.request.get("/api/auth/get-session", {
      headers: bypassSecretAdmin ? { "x-e2e-bypass": bypassSecretAdmin } : {},
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const sessionBody = (await sessionResponse.json()) as { user?: { email?: string } } | null;
    expect(sessionBody?.user?.email).toBe(email);

    // Least-privilege assertion (D-10-04): better-auth's OWN provisioning
    // code ran (never hand-created here) and landed accountRole "member"
    // with ZERO DomainMemberships, despite the admin-shaped claims fed
    // above.
    const prisma = createE2ePrisma();
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user?.accountRole).toBe("member");

      const memberships = await prisma.domainMembership.findMany({
        where: { userId: user!.id },
      });
      expect(memberships).toHaveLength(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  /**
   * AUTH-E2E-05 (13-08-PLAN.md) — an admin-invited, not-yet-activated
   * magic-link account (`emailVerified: false`, no `Account` row — exactly
   * `lib/team.ts`'s `inviteMember` shape, reproduced here via
   * `createInvitedUnverifiedUser`) that first signs in via SSO with the
   * SAME email must be merged into ONE account, not duplicated. A unique
   * per-run `sub`/`email` keeps this test's `Account(providerId, accountId)`
   * row distinct from AUTH-E2E-04's own subject/email above.
   *
   * Against the CURRENT (unconfigured) `createAuth()`, better-auth's default
   * `requireLocalEmailVerified: true` rejects this exact scenario (the
   * invited User's `emailVerified` is still `false`) — the browser lands on
   * `/auth/error` instead of the dashboard, and no `oidc` Account row is
   * ever created. This test is RED until `apps/api/src/lib/auth.ts` adds
   * `account.accountLinking`.
   */
  test("SSO login merges an admin-invited, unverified account into ONE account (AUTH-E2E-05)", async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 8);
    const email = `sso-05-${suffix}@idp.test`;

    const prisma = createE2ePrisma();
    try {
      await createInvitedUnverifiedUser(prisma, { email });

      await setOidcProfile({
        sub: `sso-05-${suffix}`,
        email,
        extraClaims: {},
      });

      await page.goto("/login");
      const ssoButton = page.getByRole("button", { name: "Mit SSO anmelden" });
      await expect(ssoButton).toBeVisible();
      await ssoButton.click();

      // Required GREEN behavior: the invited account is merged, so the
      // browser reaches the dashboard exactly like a first-time SSO login
      // (AUTH-E2E-04 above) — never redirected to /auth/error.
      await page.getByRole("link", { name: "Dashboard" }).waitFor();

      // Narrow rate-limit bypass (INFRA-06) for this ASSERTION-ONLY session
      // check — this spec's subject is the SSO account merge, not
      // rate-limiting, so it must not silently count against the shared
      // global 100-req/15-min bucket other specs in this same run also
      // consume.
      const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
      const sessionResponse = await page.request.get("/api/auth/get-session", {
        headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
      });
      expect(sessionResponse.ok()).toBeTruthy();
      const sessionBody = (await sessionResponse.json()) as { user?: { email?: string } } | null;
      expect(sessionBody?.user?.email).toBe(email);

      // Exactly ONE User row for this email — the SSO login must merge into
      // the pre-created invited row, never create a second User.
      const users = await prisma.user.findMany({ where: { email } });
      expect(users).toHaveLength(1);

      // An Account row for provider "oidc" now exists against the SAME
      // (merged) User row.
      const oidcAccount = await prisma.account.findFirst({
        where: { userId: users[0]!.id, providerId: "oidc" },
      });
      expect(oidcAccount).not.toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });

  /**
   * CR-01 (13-REVIEW.md) — the merge above (AUTH-E2E-05) only succeeds
   * because the mock IdP's default profile asserts `emailVerified: true`.
   * `apps/api/src/lib/auth.ts` deliberately leaves `trustedProviders`
   * unset (see that file's header comment), so `handleOAuthUserInfo`'s
   * `!isTrustedProvider && !userInfo.emailVerified` clause is a SECOND,
   * independent gate on top of `requireLocalEmailVerified: false` — the
   * merge must be refused when the IdP itself never vouches the email is
   * verified, even though the local admin-invite already vetted it.
   *
   * NOTE: this spec is new coverage added by the CR-01 fix pass and has
   * NOT been run against a live `docker compose` stack in this session
   * (live Playwright/compose verification was explicitly out of scope for
   * this fix pass, per the phase's own port-conflict constraints on this
   * dev machine) — flag for a live re-run before considering CR-01 fully
   * closed end-to-end.
   */
  test("SSO login is REJECTED when the IdP's email_verified claim is false, even for an admin-invited account (CR-01)", async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 8);
    const email = `sso-cr01-${suffix}@idp.test`;

    const prisma = createE2ePrisma();
    try {
      await createInvitedUnverifiedUser(prisma, { email });

      await setOidcProfile({
        sub: `sso-cr01-${suffix}`,
        email,
        emailVerified: false,
        extraClaims: {},
      });

      await page.goto("/login");
      const ssoButton = page.getByRole("button", { name: "Mit SSO anmelden" });
      await expect(ssoButton).toBeVisible();
      await ssoButton.click();

      // Refused, not merged: the browser lands on the error page, never
      // the dashboard (mirrors magic-link-token-rejection.spec.ts's own
      // assertion shape).
      await expect(page).toHaveURL(/\/auth\/error/);

      // No session was ever issued. Narrow rate-limit bypass (INFRA-06) —
      // see the identical rationale on the other `get-session` calls in
      // this file.
      const bypassSecretRejected = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
      const sessionResponse = await page.request.get("/api/auth/get-session", {
        headers: bypassSecretRejected ? { "x-e2e-bypass": bypassSecretRejected } : {},
      });
      expect(sessionResponse.ok()).toBeTruthy();
      const sessionBody = (await sessionResponse.json()) as unknown;
      expect(sessionBody).toBeNull();

      // The invited row is untouched: still exactly one User, still
      // unverified, still no "oidc" Account row against it.
      const users = await prisma.user.findMany({ where: { email } });
      expect(users).toHaveLength(1);
      expect(users[0]?.emailVerified).toBe(false);

      const oidcAccount = await prisma.account.findFirst({
        where: { userId: users[0]!.id, providerId: "oidc" },
      });
      expect(oidcAccount).toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });
});
