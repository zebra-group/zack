import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createE2ePrisma, BASELINE_DOMAIN_HOSTNAME } from "../../src/db.js";
import { createE2eLink, CANARY_TARGET, BROWSER_UA, fetchWithFixtureRaceRetry } from "../../src/links.js";

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
 * `http://e2e.zack.local:<port>/...` with a Chromium host-resolution rule
 * mapping `e2e.zack.local -> 127.0.0.1` (hermetic, no `/etc/hosts`
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
 *
 * DISCOVERY (12-05-PLAN.md, this file, Task 2) — a genuine production bug
 * AND a genuine environment/security-architecture interaction were both
 * found writing this spec against a REAL Chromium session (never exercised
 * by `fastify.inject`, which has no browser CSP engine and serializes
 * `payload:` as JSON by default):
 *
 *   1. [Rule 1 bug, FIXED in apps/api/src/routes/redirect.ts] `renderPasswordPage`'s
 *      own `<form method="POST" action="/${slug}/verify">` carries no
 *      `enctype`, so every real browser submits it as
 *      `application/x-www-form-urlencoded` — never `application/json`,
 *      the only shape `fastify.inject`'s `payload:` option had ever
 *      exercised. Fastify's built-in parsers cover only
 *      `application/json`/`text/plain`; with no urlencoded parser
 *      registered, a REAL visitor's password submission got a bare 415
 *      Unsupported Media Type, never reaching `bcrypt.compare`. Fixed by a
 *      plugin-scoped `addContentTypeParser` in `registerRedirectRoute`
 *      (RED->GREEN test: `apps/api/test/redirect.integration.test.ts`'s new
 *      "accepts a REAL browser form submission" case).
 *
 *   2. [Environmental, NOT auto-fixable — documented, not weakened] Even
 *      with (1) fixed, a LITERAL DOM `<form>` submit (or an in-page
 *      `fetch()`/XHR to the same relative path) is unconditionally blocked
 *      by Chromium: `@fastify/helmet`'s default CSP directives include
 *      `upgrade-insecure-requests` (confirmed via a live response header
 *      dump), which upgrades the form's resolved action URL's scheme to
 *      `https` before evaluating the `form-action 'self'` directive against
 *      it — and since this E2E stack serves plain HTTP with no TLS listener
 *      (D-03/D-04: TLS termination is the OPERATOR's responsibility, never
 *      bundled), that upgraded-scheme URL both violates `'self'` (scheme
 *      mismatch) AND cannot actually connect (`ERR_SSL_PROTOCOL_ERROR` if it
 *      were the CSP that let it through). This upgrade is exempted ONLY for
 *      literally-named `localhost`/loopback-IP-literal hosts (never for a
 *      custom hostname like `e2e.zack.local`, regardless of DNS/host-
 *      resolver-rules mapping) — confirmed empirically: `window.isSecureContext`
 *      stays `false` even with Chromium's `--unsafely-treat-insecure-
 *      origin-as-secure` flag, and CDP `Fetch.continueResponse` stripping
 *      the CSP header from the already-paused response does NOT stop the
 *      enforcement (Blink evaluates CSP from an earlier point in its
 *      navigation pipeline than DevTools' Fetch domain interception).
 *      Empirically confirmed a SECOND, independent blocker exists even if
 *      CSP could be defeated: `issueUnlockCookie` sets `secure: NODE_ENV ===
 *      "production"`, and this compose image is deliberately built with
 *      `NODE_ENV=production` (INFRA-01, "production-SHAPE topology
 *      fidelity", `docker-compose.e2e.yml`'s own header comment) — so the
 *      unlock cookie is ALWAYS `Secure`. A real Chromium `page` navigation
 *      (unlike Playwright's own `page.request`/`APIRequestContext`
 *      networking layer) enforces the Secure-cookie-requires-a-trustworthy-
 *      origin rule when SENDING a cookie back, and `e2e.zack.local` is not
 *      Chromium's literal `localhost`/loopback-IP-literal allowlist —
 *      confirmed by manually injecting the cookie via
 *      `context.addCookies()` under the correct domain/path and observing a
 *      subsequent REAL `page.goto()` still re-prompts (the cookie is
 *      correctly stored but Chromium withholds it on the outgoing plain-HTTP
 *      request). This is a fundamental, environment-independent consequence
 *      of this project's own deliberate choices (D-01 production-fidelity
 *      E2E + operator-delegated TLS + CR-07's non-`localhost` redirect
 *      domain) — NOT a local-sandbox artifact, and not something a single
 *      test file should paper over by weakening the cookie's `Secure` flag
 *      or standing up new TLS infrastructure unilaterally.
 *
 *   Given (2), the closest-to-real-browser proof achievable without an
 *   architectural change (new TLS-terminating infra, or loosening a
 *   security-critical cookie flag) is: use the real `page` for every
 *   RENDERING assertion (host-resolution, password-page content, no-leak),
 *   and use `page.request` (Playwright's own HTTP client, but bound to and
 *   SHARING the exact same `BrowserContext` cookie jar as `page` — Playwright
 *   docs: "cookie jar is shared between the API request context and the
 *   actual browser tabs") for the verify POST and the cookie-persistence
 *   check, since `page.request` is not a DOM-initiated action and therefore
 *   never triggers the CSP `form-action`/`upgrade-insecure-requests` block,
 *   and (empirically confirmed) does not withhold a `Secure` cookie on a
 *   subsequent plain-HTTP request the way a real Chromium navigation does.
 *   This still proves the REAL signed-cookie issuance + validation + no-
 *   re-prompt guarantee through the SAME browser context's real cookie
 *   store — only the literal "click a button" mechanic for the two POSTs is
 *   swapped for `page.request.post`, which is unavoidable given (2).
 */
test.use({
  launchOptions: {
    args: ["--host-resolver-rules=MAP e2e.zack.local 127.0.0.1"],
  },
  userAgent: BROWSER_UA,
});

/**
 * The registered redirect domain's origin from the BROWSER's point of view.
 * The Chromium `--host-resolver-rules` flag above maps only
 * `e2e.zack.local`'s HOSTNAME to `127.0.0.1` — it never touches the port,
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
/**
 * `page.request` (this file's Task 2 test) is Playwright's own Node-side
 * HTTP client — a SEPARATE network stack from Chromium's browser process,
 * unaffected by the `--host-resolver-rules` flag above (that flag is a
 * Chromium launch argument). It therefore cannot resolve the custom
 * `e2e.zack.local` hostname on its own; instead it connects to the real,
 * always-resolvable `localhost` and presents an explicit `Host` header
 * override — the exact mechanism 12-01's spike proved Fastify honors
 * unmodified. Because Playwright's request-context cookie jar is SHARED
 * with `page`, and the app's `Set-Cookie` response is driven by the `Host`
 * header (matching the real registered `e2e.zack.local` Domain) rather
 * than the literal connection target, this still exercises the real
 * `e2e.zack.local`-scoped redirect engine end to end.
 */
const LOCAL_ORIGIN = `http://localhost:${process.env.E2E_APP_PORT ?? "3000"}`;

test.describe("REDIRECT-E2E-02: password gate over a real browser page + cookie jar", () => {
  test("Chromium host-resolution reaches the redirect engine (branded password page, not the SPA); target absent pre-unlock", async ({
    page,
  }) => {
    const prisma = createE2ePrisma();
    try {
      // Wrapped in fetchWithFixtureRaceRetry (12-REVIEW.md WR-01): this
      // file's own header comment documents the exact db-isolation.spec.ts
      // truncate race every other feature spec is already protected
      // against — this file previously had NO protection at all, despite
      // being exactly as exposed (create-then-immediately-page.goto against
      // an unguarded `createE2eLink` call). `body` is captured via closure
      // and re-assigned on every attempt so the assertions below always
      // reflect the attempt `isExpected` actually accepted.
      let body = "";
      const navResponse = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `pw-gate-hostres-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: CANARY_TARGET,
            password: "correct-horse-battery",
          });

          const response = await page.goto(`${TARGET_ORIGIN}/${slug}`);
          body = await page.content();
          return response;
        },
        (response) => response !== null && response.status() === 200 && body.includes("Dieser Link ist geschützt"),
      );

      expect(navResponse?.status()).toBe(200);
      // Can ONLY render if the browser reached the redirect engine on
      // e2e.zack.local via the host-resolver rule above — not the CR-07
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

  test("wrong password rejected with the LOCKED error (no leak); correct password frees; unlock cookie carries on the next request (no re-prompt)", async ({
    page,
  }) => {
    const prisma = createE2ePrisma();
    try {
      // In-stack, always-reachable target (12-RESEARCH.md Environment
      // Availability) — the visitor's own connection follows the final
      // 302, not the app container, so this keeps the test hermetic
      // regardless of outbound internet access from the compose stack.
      const target = `${TARGET_ORIGIN}/health`;

      // This entire 4-step flow (create fixture -> initial GET -> wrong
      // verify -> correct verify -> cookie-carried GET) reads the SAME
      // just-created Link row across several real HTTP round-trips —
      // db-isolation.spec.ts's concurrent Link-table truncates (this file's
      // header comment) can wipe that row at ANY point in the sequence, not
      // only before the first request. 12-REVIEW.md WR-01 flagged this file
      // as having NO protection at all; wrapping only the first step would
      // leave steps 2-4 exactly as exposed, so the WHOLE flow is wrapped in
      // fetchWithFixtureRaceRetry and re-run end to end (fresh slug, fresh
      // link, fresh navigation) whenever the final step doesn't land on the
      // expected unlocked target. Each intermediate response/body is
      // captured via closure and re-assigned on every attempt, so the
      // assertions below always reflect the attempt that actually matched
      // (or, on final exhaustion, the last attempt made).
      let initialBody = "";
      let wrongBody = "";
      let correctResponse: Awaited<ReturnType<typeof page.request.post>> | undefined;

      const carriedResponse = await fetchWithFixtureRaceRetry(
        async () => {
          const slug = `pw-gate-flow-${randomUUID()}`;
          await createE2eLink(prisma, {
            slug,
            targetUrl: target,
            password: "correct-horse-battery",
          });

          // 1. Initial GET via the REAL browser -> password page, target absent (no leak).
          await page.goto(`${TARGET_ORIGIN}/${slug}`);
          initialBody = await page.content();

          // 2. Wrong password -> the LOCKED inline error, still no leak.
          //
          // Submitted via page.request (this file's header comment explains
          // why: a literal DOM <form>/fetch() submit is unconditionally CSP-
          // blocked on this plain-HTTP, non-"localhost" origin). page.request
          // shares the SAME BrowserContext cookie jar as `page`, so this is
          // still the real browser session's own store, not a bare API test.
          const wrongResponse = await page.request.post(`${LOCAL_ORIGIN}/${slug}/verify`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME },
            form: { password: "wrong-guess" },
          });
          wrongBody = await wrongResponse.text();

          // 3. Correct password -> unlocked: 302 to the exact target, Set-Cookie present.
          correctResponse = await page.request.post(`${LOCAL_ORIGIN}/${slug}/verify`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME },
            form: { password: "correct-horse-battery" },
            maxRedirects: 0,
          });

          // 4. Same shared-jar request to the slug -> straight through, no
          // re-prompt: proves the signed, httpOnly, path-scoped unlock cookie
          // the browser session's own cookie store now holds is honored on the
          // very next request. Assert on the response OUTCOME only — never
          // attempt to read the cookie's raw (httpOnly, signed) value.
          return page.request.get(`${LOCAL_ORIGIN}/${slug}`, {
            headers: { host: BASELINE_DOMAIN_HOSTNAME },
            maxRedirects: 0,
          });
        },
        (response) => response.status() === 302 && response.headers()["location"] === target,
      );

      expect(initialBody).toContain("Dieser Link ist geschützt");
      expect(initialBody).not.toContain(target);
      expect(wrongBody).toContain("Dieser Link ist geschützt");
      expect(wrongBody).toContain("Falsches Passwort. Bitte erneut versuchen.");
      expect(wrongBody).not.toContain(target);
      expect(correctResponse?.status()).toBe(302);
      expect(correctResponse?.headers()["location"]).toBe(target);
      expect(correctResponse?.headers()["set-cookie"]).toBeDefined();
      expect(carriedResponse.status()).toBe(302);
      expect(carriedResponse.headers()["location"]).toBe(target);
    } finally {
      await prisma.$disconnect();
    }
  });
});
