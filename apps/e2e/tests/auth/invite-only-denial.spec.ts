import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { findMagicLinkUrl } from "../../src/mailpit.js";

/**
 * AUTH-E2E-03 (13-04-PLAN.md) — proves invite-only enforcement through the
 * REAL flow: a genuinely non-invited email (no `User` row exists at all —
 * its non-existence IS the fixture, nothing is seeded for it) never
 * receives a magic-link email and never obtains a session.
 *
 * Per `apps/api/src/lib/auth.ts`'s `sendMagicLink` callback:
 *
 *   const allowed = await isEmailAllowed(prisma, email);
 *   if (!allowed) return; // sendMagicLinkEmail is NEVER reached
 *
 * `isEmailAllowed` (`lib/allowlist.ts`) is a plain `User`-row existence
 * check. For a non-existent row this short-circuits BEFORE
 * `sendMagicLinkEmail` is even called — so Mailpit receives ZERO messages
 * for this recipient, not a message that then fails to log in. The correct
 * proof of denial is therefore the ABSENCE of an email plus the ABSENCE of
 * a session — never the initial POST response shape, which stays a
 * neutral 200 either way (D-01) specifically so a non-allowlisted email
 * cannot be distinguished from an allowlisted one by response alone. This
 * spec treats that neutral 200 as expected-by-design, not as the thing
 * being proven.
 *
 * Uses a DEDICATED, never-seeded recipient (`not-invited-<random>@nobody
 * .kurzly.local`) so the short 4s no-email timeout below is deterministic —
 * no baseline seed, no other spec, and no earlier task in this phase ever
 * creates a `User` row for this address, and it is never reused elsewhere.
 *
 * Sends the INFRA-06 `x-e2e-bypass` header on the POST (mirroring
 * `magic-link-round-trip.spec.ts`/`magic-link-token-rejection.spec.ts`
 * exactly) so this single request never contends the shared IP rate-limit
 * bucket AUTH-E2E-07 (13-06) deliberately trips.
 */
test("non-invited email yields zero Mailpit message and zero session (AUTH-E2E-03)", async ({
  request,
  browser,
  baseURL,
}) => {
  const nonInvitedEmail = `not-invited-${randomUUID().slice(0, 8)}@nobody.kurzly.local`;

  const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  const magicLinkResponse = await request.post("/api/auth/sign-in/magic-link", {
    data: { email: nonInvitedEmail, callbackURL: "/", errorCallbackURL: "/auth/error" },
    headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
  });
  // D-01: the neutral 200 is EXPECTED BY DESIGN for a non-allowlisted email
  // — it is not, itself, proof of anything. Asserted here only to document
  // that this spec is not relying on a distinguishable HTTP response as the
  // denial signal (13-RESEARCH.md "sendMagicLink Neutral-Response,
  // Confirmed").
  expect(magicLinkResponse.status()).toBe(200);

  // Proof 1: zero email. `sendMagicLinkEmail` is never reached for a
  // non-existent `User` row, so Mailpit's recipient-scoped search has
  // nothing to find — `findMagicLinkUrl` MUST throw its own no-message
  // timeout. A short timeout keeps this deterministic without waiting on
  // the default 20s bound (the message will never appear, ever).
  await expect(findMagicLinkUrl(nonInvitedEmail, 4_000)).rejects.toThrow(
    /No magic-link email found/,
  );

  // Proof 2: zero session. Even in the hypothetical case a token somehow
  // existed, no session may result. A FRESH, cookie-less BrowserContext
  // (never the `request` fixture's own context, whose cookie jar could in
  // principle already carry unrelated state) proves this from a genuinely
  // cold client, mirroring the token-rejection spec's convention.
  const freshContext = await browser.newContext({
    baseURL: baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
  });
  try {
    const freshPage = await freshContext.newPage();
    // Narrow rate-limit bypass (INFRA-06) for this ASSERTION-ONLY session
    // check — this spec's subject is invite-only denial, not rate-limiting
    // (that's rate-limit-bypass.spec.ts's/resend-rate-limit.spec.ts's own
    // job), so it must not silently count against the shared global
    // 100-req/15-min bucket other specs in this same run also consume.
    const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    const sessionResponse = await freshPage.request.get("/api/auth/get-session", {
      headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
    });
    expect(sessionResponse.ok()).toBeTruthy();
    expect(await sessionResponse.json()).toBeNull();
  } finally {
    await freshContext.close();
  }
});
