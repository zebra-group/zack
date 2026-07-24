import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";

/**
 * End-to-end proof of the narrow rate-limit bypass (INFRA-06, T-11-01,
 * 11-06-PLAN.md Task 1) — proves the mechanism landed in 11-02-PLAN.md
 * (`apps/api/src/plugins/rateLimit.ts`'s env-gated `allowList`) survives
 * against the REAL running built image, not just `apps/api`'s own
 * `fastify.inject`-based integration test harness.
 *
 * `test.describe.serial` (not the default parallel-within-file scheduling)
 * deliberately runs these two tests, in file order, on one worker, against
 * the SAME probe IP:
 *
 *   1. Negative case FIRST: 6 POSTs to `/api/auth/sign-in/magic-link`
 *      WITHOUT the `x-e2e-bypass` header. `MAGIC_LINK_RATE_LIMIT` is 5
 *      requests/15min per IP (apps/api/src/plugins/rateLimit.ts, no
 *      `keyGenerator` override so it defaults to IP-based), so the 6th
 *      request in this burst must be a real 429 — proving the limiter is
 *      not silently defeated by `NODE_ENV`, the presence of the bypass
 *      mechanism, or any other global condition (RESEARCH Pitfall 6).
 *   2. Positive case SECOND, against the SAME already-tripped IP bucket: 6
 *      more POSTs WITH the correct `x-e2e-bypass` header must ALL succeed
 *      (zero 429s) — proving `allowList`'s bypass overrides an
 *      already-429'd bucket for that IP, not merely "a fresh bucket that
 *      never happened to get hit."
 *
 * Auth-independent: uses only Playwright's `request` (APIRequestContext)
 * fixture, no navigation, no `storageState`. The probe email is
 * deliberately unseeded/non-allowlisted (mirrors
 * apps/api/test/rate-limit-bypass.test.ts's `ratelimit-probe@example.com`
 * pattern) — the rate-limit hook runs before better-auth's `sendMagicLink`
 * allowlist check, so the response status under test here is independent
 * of whether the email belongs to a real seeded user.
 */
const PROBE_EMAIL = "rate-limit-bypass-e2e-probe@example.com";
const BURST_SIZE = 6; // one past MAGIC_LINK_RATE_LIMIT.max (5)

async function postMagicLink(
  request: APIRequestContext,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  return request.post("/api/auth/sign-in/magic-link", {
    data: { email: PROBE_EMAIL },
    headers,
  });
}

test.describe.serial("rate-limit bypass — real 429 proof (INFRA-06)", () => {
  test("a burst WITHOUT the x-e2e-bypass header still trips a real 429", async ({ request }) => {
    const statuses: number[] = [];
    for (let i = 0; i < BURST_SIZE; i += 1) {
      const response = await postMagicLink(request);
      statuses.push(response.status());
    }

    // The limiter is not silently defeated: the 6th request in this burst
    // (MAGIC_LINK_RATE_LIMIT = 5 requests/15min) must be a real 429.
    expect(statuses[BURST_SIZE - 1]).toBe(429);
  });

  test("an equivalent burst WITH the correct x-e2e-bypass header all succeed, even against the already-tripped bucket", async ({
    request,
  }) => {
    const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    expect(
      bypassSecret,
      "E2E_RATE_LIMIT_BYPASS_SECRET must be set (scripts/e2e-compose.sh exports it) for this spec to prove anything meaningful",
    ).toBeTruthy();

    for (let i = 0; i < BURST_SIZE; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- deliberately sequential burst, not a race
      const response = await postMagicLink(request, { "x-e2e-bypass": bypassSecret as string });
      expect(response.status()).not.toBe(429);
    }
  });
});
