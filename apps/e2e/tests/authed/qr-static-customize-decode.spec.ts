import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { BASELINE_DOMAIN_HOSTNAME, createE2ePrisma } from "../../src/db.js";
import { createE2eLink } from "../../src/links.js";
import { decodeQrImage } from "../../src/qr.js";

/**
 * QR-E2E-01 (15-02-PLAN.md) — a static QR created through the REAL
 * LinkDetailView.vue "QR-Code" entry-point button (`handleQrCode`: no
 * existing static QR for a fresh fixture Link -> `createQrCode` ->
 * deep-link to `/qr-codes?selected={id}`), then customized through the
 * REAL QrStudioPanel.vue controls (a color swatch, the "Runde Module"
 * toggle, a logo upload) — each persisting via its own PATCH before the
 * next control is touched (`persistStyle`'s `mutationSeq` guard,
 * 15-RESEARCH.md Pitfall 4).
 *
 * The crux assertion: the server-rendered PNG bytes (fetched via an
 * authenticated `page.request.get`, 15-RESEARCH.md Pitfall 2) decode via
 * `decodeQrImage` (verbatim `sharp`+`jsQR` port, apps/e2e/src/qr.ts) back
 * to the EXACT short URL Kurzly constructs for a static QR —
 * `https://{hostname}/{slug}?qr={id}` — NEVER `Link.targetUrl`
 * (`resolveQrPayload`, apps/api/src/routes/qrCodes.ts; 15-RESEARCH.md
 * Summary point 1, Pitfall 1). A QR never encodes the raw destination —
 * only Kurzly's own short URL, so every scan is a real, trackable request.
 *
 * Scoped to chromium-admin only (see the `beforeEach` skip below) —
 * nothing here exercises role-differentiated behaviour; member/domain-scoped
 * QR authz is Phase 17's job (15-CONTEXT.md Deferred Ideas).
 */
test.describe("QR-E2E-01: static QR create + customize + decode round-trip", () => {
  // apps/e2e/tests/smoke/db-isolation.spec.ts truncates QrCode/QrRemapHistory/
  // Link concurrently during the FULL-suite phase gate (same documented
  // cross-file race links-crud.spec.ts's header comment covers for the Link
  // table). A whole-journey retry with a fresh per-test random slug/Link is
  // the UI-flow equivalent and is collision-free: every retry attempt re-runs
  // this test function from scratch, minting brand-new random identifiers.
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-admin",
      "QR-E2E-01 is admin-scoped; member/domain-scoped QR authz is Phase 17 (AUTHZ-E2E-01), per 15-CONTEXT.md Deferred Ideas",
    );

    // Mirrors links-crud.spec.ts's WR-01 fix: makes every retry visible in CI
    // output, so "this test retried" is never silently indistinguishable from
    // "this test passed clean" — a retry firing repeatedly across runs is a
    // signal worth investigating, not assuming away as the known race.
    if (testInfo.retry > 0) {
      console.warn(
        `[qr-static-customize-decode.spec.ts] retry ${testInfo.retry}/${testInfo.project.retries} firing for "${testInfo.title}" — ` +
          "this MAY be the documented db-isolation.spec.ts cross-file QrCode/Link-table truncate race, or a genuine intermittent regression. " +
          "If this fires repeatedly across runs, investigate.",
      );
    }
  });

  test("static QR: create via UI, customize color/rounded/logo, PNG decodes to its short URL", async ({ page }) => {
    const hex = randomUUID().slice(0, 8);
    const slug = `e2e-qr-${hex}`;
    const targetUrl = `https://example.com/qr-target-${hex}`;

    const prisma = createE2ePrisma();
    try {
      // Fixture Link — NOT this test's own subject (that's the QR-Code
      // button/Studio flow below). No password/expiry/UTM needed.
      const link = await createE2eLink(prisma, { slug, targetUrl });

      await page.goto(`/links/${link.id}`);
      await expect(page.locator(".link-slug")).toContainText(slug);

      // --- CREATE: click the REAL "QR-Code" entry-point button ---
      // A fresh fixture Link has no static QR yet, so handleQrCode's
      // listQrCodes()+filter lookup finds none and creates one on the spot,
      // then router.push({name:"qr-codes", query:{selected: created.id}}).
      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/qr-codes",
        ),
        page.getByRole("button", { name: "QR-Code" }).click(),
      ]);
      expect(createResponse.status()).toBe(201);
      await expect(page).toHaveURL(/\/qr-codes\?selected=/);

      const qrId = new URL(page.url()).searchParams.get("selected");
      expect(qrId).toBeTruthy();

      // --- CUSTOMIZE: color swatch ---
      // Default stored color is "#000000" (DEFAULT_QR_COLOR, lib/qrCodes.ts),
      // which is NOT among the four locked PRODUCT_COLORS swatches — so no
      // swatch starts `.selected`, and `:not(.selected)` matches all four.
      // Clicking the first one is guaranteed to be a real change (setColor's
      // `local.color === color` early-return never fires here).
      const [colorPatch] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/qr-codes/${qrId}`,
        ),
        page.locator(".color-swatch:not(.selected)").first().click(),
      ]);
      expect(colorPatch.ok()).toBe(true);

      // --- CUSTOMIZE: "Runde Module" toggle ---
      // roundedModules defaults to false, so this click is always a real
      // change (toggleRounded flips it to true unconditionally).
      const [roundedPatch] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/qr-codes/${qrId}`,
        ),
        page.locator(".rounded-toggle").click(),
      ]);
      expect(roundedPatch.ok()).toBe(true);

      // --- CUSTOMIZE: logo upload ---
      // A genuinely tiny (64x64, solid-color) in-memory PNG — comfortably
      // under MAX_LOGO_BYTES (1,400,000, QrStudioPanel.vue) and the server's
      // LOGO_DATA_MAX_LENGTH (1,900,000 base64 chars, routes/qrCodes.ts).
      // Playwright's setInputFiles drives the hidden `input.hidden-file-input`
      // directly despite its `display:none` (15-RESEARCH.md Pitfall 3).
      const logoBuffer = await sharp({
        create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 58, b: 95, alpha: 1 } },
      })
        .png()
        .toBuffer();

      const [logoPatch] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/qr-codes/${qrId}`,
        ),
        page
          .locator("input.hidden-file-input")
          .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logoBuffer }),
      ]);
      expect(logoPatch.ok()).toBe(true);

      // --- DECODE round-trip ---
      // page.request shares the SAME BrowserContext cookie jar as page, so it
      // carries the chromium-admin project's storageState session cookie the
      // 401-gated render endpoint requires (15-RESEARCH.md Pattern 2,
      // Pitfall 2) — never a bare/unauthenticated fetch.
      const renderResponse = await page.request.get(`/api/qr-codes/${qrId}/render.png`);
      expect(renderResponse.status()).toBe(200);
      expect(renderResponse.headers()["content-type"]).toBe("image/png");

      const pngBytes = Buffer.from(await renderResponse.body());
      const decoded = await decodeQrImage(pngBytes);

      // The literal "qr" here IS QR_SCAN_PARAM (apps/api/src/lib/redirectEngine.ts)
      // -- apps/e2e cannot import it (unreachable via @kurzly/api's exports
      // map, `.`/`./prisma-client` only, same constraint as createLink/
      // updateLink before it) -- so it is hardcoded here with this source
      // comment as the paper trail. Built from fixture values (hostname/slug/
      // qrId) -- NEVER link.targetUrl. resolveQrPayload's static-QR branch
      // encodes the QR's OWN short URL, never the raw destination
      // (15-RESEARCH.md Summary point 1, Pitfall 1) -- a QR pointed at
      // targetUrl directly would skip the password/expiry gates and the scan
      // click hook entirely, and would silently break on a later edit.
      const expected = `https://${BASELINE_DOMAIN_HOSTNAME}/${slug}?qr=${qrId}`;
      expect(decoded).toBe(expected);
    } finally {
      await prisma.$disconnect();
    }
  });
});
