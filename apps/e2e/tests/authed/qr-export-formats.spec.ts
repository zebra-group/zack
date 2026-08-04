import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { createE2eLink } from "../../src/links.js";
import { createE2eQrCode, decodeQrImage } from "../../src/qr.js";

/**
 * QR-E2E-03 (15-04-PLAN.md) — the REAL `.export-png`/`.export-svg` Studio
 * buttons (`QrStudioPanel.vue`'s `exportFile`: fetches the server-rendered
 * bytes as a Blob, then creates+clicks+removes an `<a download>` element)
 * each trigger a genuine browser download, and each downloaded file is
 * independently proven valid by decoding it via `decodeQrImage`
 * (`sharp`+`jsQR`, apps/e2e/src/qr.ts) back to the SAME expected short-URL
 * string — the strongest available "valid file" proof, well beyond "a
 * non-empty download happened".
 *
 * The SVG download is rasterized via `sharp(bytes).png().toBuffer()` before
 * decoding — exactly mirroring `apps/api/test/qrDecode.test.ts`'s own
 * SVG-decode case (`decodeQrImage` decodes PNG/raw-pixel bytes only; an SVG
 * string must be rasterized first).
 *
 * Export validity is independent of customization state (15-RESEARCH.md
 * Open Question 2) — the QR under test is seeded once via
 * `createE2eQrCode({variant:"static"})` bound to a fixture Link, since QR
 * *creation* is not this spec's subject (that's QR-E2E-01's job); the export
 * UI is this spec's genuine subject, so the real buttons are driven.
 *
 * Never asserts the decoded payload equals `link.targetUrl`
 * (15-RESEARCH.md Pitfall 1) — a static QR always encodes its OWN short URL
 * (`https://{hostname}/{slug}?qr={id}`, `resolveQrPayload`,
 * apps/api/src/routes/qrCodes.ts), never the raw destination.
 *
 * Scoped to chromium-admin only (see the `beforeEach` skip below) — nothing
 * here exercises role-differentiated behaviour; member/domain-scoped QR
 * authz is Phase 17's job (15-CONTEXT.md Deferred Ideas).
 */
test.describe("QR-E2E-03: PNG and SVG exports are both valid, independently decodable downloads", () => {
  // apps/e2e/tests/smoke/db-isolation.spec.ts truncates QrCode/QrRemapHistory/
  // Link concurrently during the FULL-suite phase gate (same documented
  // cross-file race links-crud.spec.ts's/qr-static-customize-decode.spec.ts's/
  // qr-dynamic-remap.spec.ts's header comments cover for these tables). This
  // spec's fixtures (the Link + the static QrCode) are created OUTSIDE
  // withResetDbLock, so a sibling file's concurrent truncate mid-test is the
  // documented race — a whole-test retry with a fresh per-test random
  // slug/QR is the collision-free equivalent, since every retry attempt
  // re-runs this test function from scratch, minting brand-new random
  // identifiers.
  //
  // WR-01 (15-REVIEW.md): a finer-grained fetchWithFixtureRaceRetry-style
  // helper (apps/e2e/src/links.ts, reused by smoke/redirect-*.spec.ts) was
  // considered and deliberately NOT adopted here. That helper retries a
  // single HTTP round-trip whose closure recreates its own fixture per
  // attempt — but this test is a multi-step real-UI journey (Studio
  // navigation -> two real button-triggered downloads -> two authenticated
  // render fetches) with no single comparable value to retry around;
  // wrapping only the trailing render fetches would leave the preceding
  // download steps (which can just as easily race the same truncate)
  // unprotected. Retrofitting the whole journey into one retryable closure
  // is a materially larger, riskier change than this fix pass's scope
  // justifies — mirrors 14-REVIEW-FIX.md's identical WR-01 tradeoff call for
  // Phase 14's own multi-step UI specs. The coarser whole-test retry above,
  // plus the testInfo.retry attribution logging in the beforeEach below, is
  // the accepted tradeoff for this spec.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "QR-E2E-03 is admin-scoped; member/domain-scoped QR authz is Phase 17 (AUTHZ-E2E-01), per 15-CONTEXT.md Deferred Ideas",
    );

    // Mirrors the sibling QR specs' fix: makes every retry visible in CI
    // output, so "this test retried" is never silently indistinguishable
    // from "this test passed clean".
    if (testInfo.retry > 0) {
      console.warn(
        `[qr-export-formats.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file QrCode/Link-table truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("PNG and SVG exports are both valid, independently decodable downloads", async ({ page }) => {
    const hex = randomBytes(4).toString("hex");
    const slug = `e2e-qr-exp-${hex}`;
    const targetUrl = `https://example.com/qr-export-${hex}`;

    const prisma = createE2ePrisma();
    try {
      // Fixture Link + a static QrCode bound to it — creation itself is NOT
      // this spec's subject (QR-E2E-01 already proves the real create-button
      // flow); export validity is independent of customization state, so a
      // freshly-seeded, default-style static QR is sufficient here.
      const link = await createE2eLink(prisma, { slug, targetUrl });
      const qr = await createE2eQrCode(prisma, {
        variant: "static",
        linkId: link.id,
        name: `Export Test ${hex}`,
      });

      // The literal "qr" here IS QR_SCAN_PARAM (apps/api/src/lib/redirectEngine.ts)
      // -- apps/e2e cannot import it (unreachable via @zack/api's exports
      // map, `.`/`./prisma-client` only) -- so it is hardcoded here with this
      // source comment as the paper trail, mirroring
      // qr-static-customize-decode.spec.ts's identical note. Built from
      // fixture values (hostname/slug/qrId) -- NEVER link.targetUrl.
      const expectedShortUrl = `https://${BASELINE_DOMAIN_HOSTNAME}/${slug}?qr=${qr.id}`;

      // --- Select the seeded QR via the deep-link, confirming the Studio
      // panel mounted (its `.export-png` button visible) ---
      await page.goto(`/qr-codes?selected=${qr.id}`);
      await expect(page.locator(".export-png")).toBeVisible();

      // --- PNG export: click the REAL button, capture the REAL download ---
      const [pngDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(".export-png").click(),
      ]);
      expect(pngDownload.suggestedFilename()).toMatch(/\.png$/);
      const pngPath = await pngDownload.path();
      expect(pngPath).toBeTruthy();
      const pngBytes = readFileSync(pngPath!);
      const decodedPng = await decodeQrImage(pngBytes);
      expect(decodedPng).toBe(expectedShortUrl);

      // --- SVG export: same pattern, rasterized via sharp before decode ---
      const [svgDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(".export-svg").click(),
      ]);
      expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/);
      const svgPath = await svgDownload.path();
      expect(svgPath).toBeTruthy();
      const svgBytes = readFileSync(svgPath!);
      const rasterizedSvg = await sharp(svgBytes).png().toBuffer();
      const decodedSvg = await decodeQrImage(rasterizedSvg);
      expect(decodedSvg).toBe(expectedShortUrl);

      // --- CONTENT-TYPE: authenticated page.request (shares the
      // chromium-admin storageState cookie jar the 401-gated render
      // endpoints require, 15-RESEARCH.md Pattern 2/Pitfall 2) ---
      const pngResp = await page.request.get(`/api/qr-codes/${qr.id}/render.png`);
      expect(pngResp.status()).toBe(200);
      expect(pngResp.headers()["content-type"]).toBe("image/png");

      const svgResp = await page.request.get(`/api/qr-codes/${qr.id}/render.svg`);
      expect(svgResp.status()).toBe(200);
      expect(svgResp.headers()["content-type"]).toBe("image/svg+xml");
      const svgText = await svgResp.text();
      expect(svgText).toContain("<svg");
    } finally {
      await prisma.$disconnect();
    }
  });
});
