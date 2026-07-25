import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createE2ePrisma } from "../../src/db.js";
import { BROWSER_UA, createE2eLink } from "../../src/links.js";
import { createE2eQrCode } from "../../src/qr.js";

/**
 * QR-E2E-02 (15-03-PLAN.md) — a dynamic QR's printed `/q/:code` URL resolves
 * to target A, then — after a REAL Studio remap — to target B, while the
 * printed URL itself never changes, and an ordered `QrRemapHistory` row is
 * recorded.
 *
 * The initial "bound to target A" state is seeded DIRECTLY via Prisma
 * (`createE2eQrCode`, apps/e2e/src/qr.ts) — QR CREATION is not this test's
 * subject (the real "+ Dynamischer QR" UI always binds to `links.value[0]`,
 * whatever `GET /api/links` returns first, which is not deterministic enough
 * to reliably set up "starts bound to target A"; 15-RESEARCH.md's
 * Alternatives Considered). Only the REMAP itself is driven through the real
 * `.target-select` dropdown on the selected `QrCodesView.vue` card
 * (`handleRemapChange` -> `PATCH /api/qr-codes/:id {targetLinkId}` ->
 * `remapQrCode`'s `$transaction`).
 *
 * `GET /q/:code` is host-agnostic by design (`routes/qrRedirect.ts` never
 * calls `resolveActiveDomainByHost` — `QrCode.code` is a flat,
 * globally-unique namespace, not domain-scoped like `Link.slug`) — so both
 * redirect assertions hit `PLAYWRIGHT_BASE_URL` directly via the `request`
 * fixture, with no `Host` header handling, unlike Phase 12's `/:slug` tests.
 *
 * Scoped to chromium-admin only (see the `beforeEach` skip below) — nothing
 * here exercises role-differentiated behaviour; member/domain-scoped QR
 * authz is Phase 17's job (15-CONTEXT.md Deferred Ideas).
 */
test.describe("QR-E2E-02: dynamic QR remap changes /q/:code resolution, records ordered history", () => {
  // apps/e2e/tests/smoke/db-isolation.spec.ts truncates QrCode/QrRemapHistory/
  // Link concurrently during the FULL-suite phase gate (same documented
  // cross-file race links-crud.spec.ts's/qr-static-customize-decode.spec.ts's
  // header comments cover for these tables). This test's fixtures
  // (targetA/targetB Links + the dynamic QrCode) are all created OUTSIDE
  // withResetDbLock, so a sibling file's concurrent truncate mid-test is the
  // documented race — a whole-test retry with fresh per-test random
  // slugs/code is the collision-free equivalent, since every retry attempt
  // re-runs this test function from scratch, minting brand-new random
  // identifiers.
  //
  // WR-01 (15-REVIEW.md): the review specifically asks whether THIS spec's
  // two `/q/:code` GETs (the one genuinely single-HTTP-round-trip-shaped
  // reads in this phase) could each be wrapped individually in
  // fetchWithFixtureRaceRetry-style retry, keeping only a last-resort outer
  // retries:2. Deliberately NOT adopted: fetchWithFixtureRaceRetry's closure
  // recreates its OWN fixture on every attempt, but the two GETs here share
  // fixtures (targetA/targetB/qr) created once at the top of the test and
  // straddle a real-UI remap step in between — retrying just the "before"
  // GET after a truncate wipes the shared rows would still fail (nothing
  // recreates targetA/qr), and the SAME race window also covers the UI
  // navigation + PATCH between the two GETs, which fetchWithFixtureRaceRetry
  // cannot wrap at all. Splitting only the two GETs would therefore add
  // complexity without closing the actual race window. Retrofitting the
  // whole journey (fixtures + both GETs + the UI remap) into one retryable
  // closure is a materially larger, riskier change than this fix pass's
  // scope justifies — mirrors 14-REVIEW-FIX.md's identical WR-01 tradeoff
  // call for Phase 14's own multi-step UI specs. The coarser whole-test
  // retry above, plus the testInfo.retry attribution logging in the
  // beforeEach below, is the accepted tradeoff for this spec.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "QR-E2E-02 is admin-scoped; member/domain-scoped QR authz is Phase 17 (AUTHZ-E2E-01), per 15-CONTEXT.md Deferred Ideas",
    );

    // Mirrors links-crud.spec.ts's/qr-static-customize-decode.spec.ts's fix:
    // makes every retry visible in CI output, so "this test retried" is
    // never silently indistinguishable from "this test passed clean".
    if (testInfo.retry > 0) {
      console.warn(
        `[qr-dynamic-remap.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file QrCode/QrRemapHistory/Link-table truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("dynamic QR remap changes /q/:code resolution and records ordered history", async ({
    page,
    request,
  }) => {
    const hex = randomUUID().slice(0, 8);

    const prisma = createE2ePrisma();
    try {
      // Fixtures — targetA/targetB carry no UTM, so applyUtmParams
      // (redirectEngine.ts) passes each targetUrl through unchanged, making
      // the redirect Location assertions exact string equality.
      const targetA = await createE2eLink(prisma, {
        slug: `e2e-qr-a-${hex}`,
        targetUrl: `https://example.com/target-a-${hex}`,
      });
      const targetB = await createE2eLink(prisma, {
        slug: `e2e-qr-b-${hex}`,
        targetUrl: `https://example.com/target-b-${hex}`,
      });
      const qr = await createE2eQrCode(prisma, {
        variant: "dynamic",
        linkId: targetA.id,
        name: `Remap Test QR ${hex}`,
      });

      // --- BEFORE remap: the printed /q/:code resolves to target A ---
      // An explicit BROWSER_UA is REQUIRED (Rule 1 bug fix, discovered live
      // against the built compose image, mirrors redirect-*.spec.ts's own
      // documented fix): Playwright's `request` fixture's own default User-
      // Agent ("Playwright/x.y.z") is bot-classified by `isbot`
      // (apps/api/src/lib/botDetection.ts), which routes GET /q/:code to
      // the bot-OG 200 branch instead of the human 302 branch this
      // assertion needs (D-06, no exceptions for the bot branch).
      const beforeResp = await request.get(`/q/${qr.code}`, {
        maxRedirects: 0,
        headers: { "user-agent": BROWSER_UA },
      });
      expect(beforeResp.status()).toBe(302);
      expect(beforeResp.headers()["location"]).toBe(targetA.targetUrl);

      // --- REMAP via the REAL Studio UI: the selected card's .target-select ---
      await page.goto(`/qr-codes?selected=${qr.id}`);
      await expect(page.locator(".qr-card.selected .target-select")).toHaveValue(targetA.id);

      const [remapPatch] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/qr-codes/${qr.id}`,
        ),
        page.locator(".qr-card.selected .target-select").selectOption(targetB.id),
      ]);
      expect(remapPatch.ok()).toBe(true);

      // --- AFTER remap: the SAME printed /q/:code now resolves to target B ---
      const afterResp = await request.get(`/q/${qr.code}`, {
        maxRedirects: 0,
        headers: { "user-agent": BROWSER_UA },
      });
      expect(afterResp.status()).toBe(302);
      expect(afterResp.headers()["location"]).toBe(targetB.targetUrl);

      // --- HISTORY: exactly one ordered QrRemapHistory row (direct Prisma) ---
      const history = await prisma.qrRemapHistory.findMany({
        where: { qrCodeId: qr.id },
        orderBy: { createdAt: "asc" },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromLinkId: targetA.id, toLinkId: targetB.id });
    } finally {
      await prisma.$disconnect();
    }
  });
});
