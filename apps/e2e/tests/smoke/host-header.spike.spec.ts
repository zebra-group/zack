import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";

/**
 * RESEARCH Open Question 1 / Assumption A1 spike (Phase 12 Wave 0 gate,
 * 12-CONTEXT.md "Host header on requests").
 *
 * Proves ONLY that Playwright's `APIRequestContext` (`request.get`) delivers
 * a caller-supplied `Host` header UNMODIFIED to the built app's Fastify
 * instance, driving `resolveActiveDomainByHost` to resolve the real
 * registered baseline Domain (`e2e.zack.local`) rather than
 * `routes/redirect.ts`'s `isAppOwnHost(localhost)` CR-07 SPA-fallback
 * branch. This is the load-bearing mechanism every feature spec in this
 * phase (12-03/12-04/12-05) depends on to target a real redirect Domain
 * over the wire instead of accidentally exercising the SPA branch.
 *
 * Deliberately does NOT instantiate a Prisma client and does NOT create any
 * Link — relies solely on the already-seeded baseline Domain
 * (`global-setup.ts`'s `seedBaseline`) plus a guaranteed-missing random
 * slug, mirroring `tests/smoke/prisma-import.spike.spec.ts`'s throwaway-spike
 * shape. Throwaway: proves the mechanism once, is not part of the feature
 * suite going forward.
 */

/**
 * Exact real Chrome UA from `apps/api/test/redirect.integration.test.ts` —
 * keeps this request on the human-visitor branch of `isBotRequest`, so a
 * bot/OG 200 can never be mistaken for the SPA-fallback or branded-404
 * evidence this spike is actually asserting on.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** `renderNotFoundPage`'s literal title (apps/api/src/lib/publicHtml.ts) — only ever rendered when a Domain resolved but the requested slug does not exist on it. */
const BRANDED_404_MARKER = "Dieser Kurzlink existiert nicht";

test.describe("host-header spike (RESEARCH OQ-1 / A1)", () => {
  test("a caller-supplied Host header reaches Fastify and resolves the real registered Domain", async ({
    request,
  }) => {
    const missingSlug = `spike-nonexistent-${randomUUID()}`;

    // Positive assertion (load-bearing): with an explicit `Host:
    // e2e.zack.local` header, `resolveActiveDomainByHost` must resolve the
    // real registered baseline Domain, then find no such slug -> branded 404
    // echoing the host. This can ONLY happen if Playwright delivered the
    // Host header unmodified to Fastify's `request.hostname`.
    const withHostHeader = await request.get(`/${missingSlug}`, {
      headers: { host: BASELINE_DOMAIN_HOSTNAME, "user-agent": BROWSER_UA },
      maxRedirects: 0,
    });
    expect(withHostHeader.status()).toBe(404);
    const withHostHeaderBody = await withHostHeader.text();
    expect(withHostHeaderBody).toContain(BRANDED_404_MARKER);
    expect(withHostHeaderBody).toContain(BASELINE_DOMAIN_HOSTNAME);
  });

  test("control: a default (localhost) Host never yields the branded 404", async ({ request }) => {
    const missingSlug = `spike-nonexistent-${randomUUID()}`;

    // Control assertion (secondary evidence): no `host` override -> defaults
    // to the config baseURL host (localhost), which is the app's OWN host
    // (CR-07's `isAppOwnHost`) -> `reply.callNotFound()` -> SPA index shell,
    // never the redirect engine's branded 404. Tolerant of the exact SPA
    // fallback status; only the branded-404 marker's absence is load-bearing
    // here, proving the delta above is genuinely Host-header-driven.
    const withoutHostHeader = await request.get(`/${missingSlug}`, {
      headers: { "user-agent": BROWSER_UA },
      maxRedirects: 0,
    });
    const withoutHostHeaderBody = await withoutHostHeader.text();
    expect(withoutHostHeaderBody).not.toContain(BRANDED_404_MARKER);
  });
});
