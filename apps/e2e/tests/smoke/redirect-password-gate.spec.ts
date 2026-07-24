import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma, BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";
import { createE2eLink, CANARY_TARGET, BROWSER_UA } from "../../src/links.js";

/**
 * REDIRECT-E2E-02 (12-05-PLAN.md) — re-proves `routes/redirect.ts`'s
 * password gate (`GET /:slug` -> `renderPasswordPage`, `POST /:slug/verify`
 * -> wrong/correct) over a REAL browser `page` + cookie jar, the one
 * guarantee in this phase whose signed, httpOnly, path-scoped unlock-cookie
 * round-trip is most naturally proven with a real cookie jar (12-CONTEXT.md
 * locked decision: `page`, not `request`, here).
 *
 * A real browser CANNOT set a forbidden `Host` header via `page.goto`, so
 * this file targets the registered redirect domain by navigating to
 * `http://e2e.kurzly.local:<port>/...` with a Chromium host-resolution rule
 * mapping `e2e.kurzly.local -> 127.0.0.1` (hermetic, no `/etc/hosts`
 * mutation — resolves the STATE blocker "confirm custom-domain testing
 * approach: /etc/hosts vs. host-header" for the browser path). This is a
 * strictly harder version of the `APIRequestContext` Host-header approach
 * 12-01's spike already proved for the API-only specs (12-03/12-04), so
 * Task 1's test below self-validates this browser mechanism before Task 2's
 * test depends on it.
 *
 * Playwright's `page` API cannot read an `httpOnly` cookie's raw VALUE by
 * design — every assertion below is on navigation/response OUTCOME, never
 * on decoding the unlock cookie (12-RESEARCH.md `unlockCookie.ts` note).
 *
 * `userAgent: BROWSER_UA` is REQUIRED here (Rule 1 bug fix, discovered live
 * against the built image): headless Chromium's own default UA contains the
 * literal substring `HeadlessChrome/<version>`, which the installed
 * `isbot@5.2.0` flags as a bot — exactly the same class of trap
 * 12-RESEARCH.md's Pitfall 1 already documents for `APIRequestContext`'s
 * default UA, but for the real browser `page` fixture instead. Without this
 * override every test below silently hit `renderBotOgPage` (200, generic
 * OG meta) instead of `renderPasswordPage`.
 */
test.use({
  launchOptions: {
    args: ["--host-resolver-rules=MAP e2e.kurzly.local 127.0.0.1"],
  },
  userAgent: BROWSER_UA,
});

/**
 * The registered redirect domain's origin from the BROWSER's point of view.
 * The Chromium `--host-resolver-rules` flag above maps only
 * `e2e.kurzly.local`'s HOSTNAME to `127.0.0.1` — it never touches the port,
 * so this origin's port must match whatever host port the compose app
 * container actually publishes on. `docker-compose.e2e.yml`/CI always
 * publish `3000` (the canonical, hardcoded default here). `E2E_APP_PORT`
 * exists solely so a LOCAL dev run can remap this alongside
 * `PLAYWRIGHT_BASE_URL` when host port 3000 is already occupied by an
 * unrelated process on the dev machine (the exact same port-remap
 * accommodation 12-01 through 12-04-SUMMARY.md already document for this
 * sandbox) — it is never set in CI/production, so the canonical "3000"
 * always applies there.
 */
const TARGET_ORIGIN = `http://${BASELINE_DOMAIN_HOSTNAME}:${process.env.E2E_APP_PORT ?? "3000"}`;

test.describe("REDIRECT-E2E-02: password gate over a real browser page + cookie jar", () => {
  test("Chromium host-resolution reaches the redirect engine (branded password page, not the SPA); target absent pre-unlock", async ({
    page,
  }) => {
    const prisma = createE2ePrisma();
    try {
      const slug = `pw-gate-hostres-${randomUUID()}`;
      await createE2eLink(prisma, {
        slug,
        targetUrl: CANARY_TARGET,
        password: "correct-horse-battery",
      });

      await page.goto(`${TARGET_ORIGIN}/${slug}`);

      const body = await page.content();
      // Can ONLY render if the browser reached the redirect engine on
      // e2e.kurzly.local via the host-resolver rule above — not the CR-07
      // SPA fallback (which would serve the app's own dashboard shell for
      // its own BASE_URL host instead).
      expect(body).toContain("Dieser Link ist geschützt");
      // No-leak (T-12-LEAK-PW): the real target must never appear in the
      // initial protected-page response, before any password check.
      expect(body).not.toContain(CANARY_TARGET);
    } finally {
      await prisma.$disconnect();
    }
  });
});
