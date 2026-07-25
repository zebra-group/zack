import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, createE2ePrisma } from "../../src/db.js";
import { createE2eLink } from "../../src/links.js";
import { createE2eQrCode } from "../../src/qr.js";

/**
 * AUTHZ-E2E-02 (17-05-PLAN.md) — proves, through the real UI/API, the
 * INTENTIONAL account-admin bypass: `requireDomainAccess`/`scopedDomainIds`
 * (`lib/authorization.ts`) both start with an `isAccountAdmin` short-circuit
 * BEFORE any `DomainMembership` lookup (17-RESEARCH.md, "admin bypass
 * short-circuit", verified directly against installed source).
 *
 * The EXISTING seeded `ADMIN_EMAIL` fixture (`apps/e2e/src/db.ts`'s
 * `seedBaseline`) already has ZERO `DomainMembership` rows — the
 * `chromium-admin` storageState project is ALREADY a live instance of this
 * bypass (17-RESEARCH.md Pattern 5). No new admin fixture is created here.
 * What this spec adds is:
 *
 *   1. An EXPLICIT precondition read (`domainMembership.count === 0`) that
 *      turns "never explicitly assigned" from an implicit fact about
 *      `seedBaseline`'s current shape into a self-documenting, regression-
 *      visible assertion (T-17-05-BYPASS-REGRESS).
 *   2. The STRONGEST available story (Assumption A2): the resource lives on
 *      a FRESH, per-test SECOND domain referenced by no `DomainMembership`
 *      for the admin OR anyone — removing any doubt that the baseline
 *      domain is merely "implicitly admin-owned by convention" rather than
 *      genuinely reached via the `accountRole === "admin"` bypass path.
 *
 * A domain-scoped member would 404 on the exact same id (AUTHZ-E2E-01,
 * `authz-domain-denial.spec.ts`) — the ONLY differentiator here is
 * `accountRole === "admin"`. Do NOT assign the admin any `DomainMembership`
 * (would destroy the precondition); do NOT mutate the seeded admin's role.
 */
test.describe("AUTHZ-E2E-02: an account-admin with zero DomainMembership rows reaches a never-assigned domain's resources", () => {
  // Mirrors authz-domain-denial.spec.ts's/qr-dynamic-remap.spec.ts's
  // precedent: the fresh second-domain + Link/QR fixtures straddle the
  // precondition read and the UI navigation, outside withResetDbLock — a
  // whole-test retry with a fresh per-test unique hostname/slug is the
  // collision-free equivalent of fetchWithFixtureRaceRetry for a spec this
  // shaped.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    // The account-admin bypass is the subject; this spec uses the
    // chromium-admin storageState `page` and would be meaningless under
    // chromium-member (a domain-scoped member is exactly AUTHZ-E2E-01's
    // denial case, not this bypass).
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "AUTHZ-E2E-02 proves the account-admin bypass via the existing chromium-admin storageState; meaningless under chromium-member",
    );

    if (testInfo.retry > 0) {
      console.warn(
        `[authz-admin-bypass.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("an account-admin with zero DomainMembership rows reaches a never-assigned domain's Link and QR", async ({
    page,
  }) => {
    const hex = randomUUID().slice(0, 8);
    const hostname = `bypass-${hex}.kurzly.local`;
    const slug = `e2e-bypass-${hex}`;

    const prisma = createE2ePrisma();
    try {
      // --- PRECONDITION: the seeded admin genuinely holds ZERO
      // DomainMembership rows. Makes "never explicitly assigned" an
      // explicit, self-documenting assertion rather than an implicit fact
      // about seedBaseline's current shape — a future regression in EITHER
      // direction (admin gains a membership, or the bypass starts requiring
      // one) fails this test loudly. ---
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
      expect(await prisma.domainMembership.count({ where: { userId: admin.id } })).toBe(0);

      // --- Seed a FRESH second domain referenced by no DomainMembership
      // for the admin OR anyone — the strongest available story (Pattern 5
      // / Assumption A2), removing any doubt the baseline domain is
      // implicitly admin-owned by convention rather than genuinely reached
      // via the accountRole bypass. Domain is never truncated by
      // withResetDbLock, so a per-test unique hostname is collision-free
      // across repeated runs. ---
      const bypassDomain = await prisma.domain.create({
        data: {
          hostname,
          type: "subdomain",
          status: "active",
          verificationTarget: hostname,
        },
      });

      const link = await createE2eLink(prisma, {
        slug,
        targetUrl: `https://example.com/authz-bypass-target-${hex}`,
        domainHostname: bypassDomain.hostname,
      });
      const qr = await createE2eQrCode(prisma, {
        variant: "static",
        linkId: link.id,
        name: `bypass-qr-${hex}`,
      });

      // Do NOT assign the admin any DomainMembership here — that would
      // destroy the precondition this whole spec is proving.

      // === UI BYPASS PROOF: the existing chromium-admin `page`, already
      // authenticated as the zero-membership admin via storageState,
      // reaches a Link on a domain it was NEVER assigned. ===
      await page.goto(`/links/${link.id}`);
      await expect(page.locator(".link-slug")).toHaveText(`/${slug}`);
      await expect(page.locator(".not-found-card")).not.toBeVisible();

      // === API BYPASS PROOF: real cookie jar via page.request — confirms
      // isAccountAdmin short-circuits the domain-scope check at the API
      // layer for multiple resource types on the never-assigned domain. ===
      const linkApiResp = await page.request.get(`/api/links/${link.id}`);
      expect(linkApiResp.status()).toBe(200);
      const qrApiResp = await page.request.get(`/api/qr-codes/${qr.id}`);
      expect(qrApiResp.status()).toBe(200);
    } finally {
      await prisma.$disconnect();
    }
  });
});
