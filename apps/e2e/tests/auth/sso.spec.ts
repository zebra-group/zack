import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma } from "../../src/db.js";
import { resetOidcProfile, setOidcProfile } from "../../src/oidc-mock.js";

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
    const sessionResponse = await page.request.get("/api/auth/get-session");
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
});
