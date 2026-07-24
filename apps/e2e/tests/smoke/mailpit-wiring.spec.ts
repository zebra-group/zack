import { test, expect, type APIRequestContext } from "@playwright/test";
import { findMagicLinkUrl } from "../../src/mailpit.js";
import { ADMIN_EMAIL, MEMBER_EMAIL } from "../../src/db.js";

/**
 * Throwaway smoke spec (INFRA-02, T-11-07) — proves Mailpit retrieval is
 * strictly recipient-scoped, with zero cross-worker email theft.
 *
 * Requests a real magic-link email for each of the two seeded baseline
 * recipients (admin, member) over real HTTP to
 * `POST /api/auth/sign-in/magic-link`, sending the `x-e2e-bypass` header
 * (INFRA-06) so the request is never rate-limited by
 * `MAGIC_LINK_RATE_LIMIT` (5/15min) regardless of how many times this spec
 * runs. The hard "this message was actually addressed to the requested
 * recipient" assertion lives inside `findMagicLinkUrl` itself
 * (`src/mailpit.ts`) — it throws rather than returning a link if the
 * retrieved message's `To` address doesn't match, so a worker resolving
 * `ADMIN_EMAIL` can never accidentally consume a link meant for
 * `MEMBER_EMAIL` (or any other worker's in-flight recipient) even when
 * both requests are in-flight concurrently at `--workers=N`.
 */
async function requestMagicLink(request: APIRequestContext, email: string): Promise<void> {
  const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  const response = await request.post("/api/auth/sign-in/magic-link", {
    data: { email },
    headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("mailpit wiring (INFRA-02)", () => {
  test("retrieves the admin's magic-link email strictly scoped to the admin recipient", async ({
    request,
  }) => {
    await requestMagicLink(request, ADMIN_EMAIL);

    // findMagicLinkUrl hard-asserts the retrieved message's To address
    // equals ADMIN_EMAIL before returning — see src/mailpit.ts.
    const url = await findMagicLinkUrl(ADMIN_EMAIL);
    expect(url).toMatch(/\/api\/auth\/magic-link\/verify\?/);
    expect(url).toContain("token=");
  });

  test("retrieves the member's magic-link email strictly scoped to the member recipient (no cross-worker theft)", async ({
    request,
  }) => {
    await requestMagicLink(request, MEMBER_EMAIL);

    // Same hard recipient assertion as above, proving the member's link is
    // never confused with the admin's concurrently in-flight request.
    const url = await findMagicLinkUrl(MEMBER_EMAIL);
    expect(url).toMatch(/\/api\/auth\/magic-link\/verify\?/);
    expect(url).toContain("token=");
  });
});
