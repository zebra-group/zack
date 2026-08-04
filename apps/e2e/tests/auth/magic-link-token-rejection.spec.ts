import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import type { PrismaClient } from "@zack/api/prisma-client";
import { createE2ePrisma } from "../../src/db.js";
import { createAllowlistedUser } from "../../src/users.js";
import { findMagicLinkUrl } from "../../src/mailpit.js";

/**
 * AUTH-E2E-02 (13-03-PLAN.md) — proves consumed / expired / malformed
 * magic-link tokens are each rejected by better-auth's own
 * `GET /api/auth/magic-link/verify` endpoint, with NO session created in
 * any case. Every case ends with an explicit
 * `GET /api/auth/get-session` assertion of an unauthenticated response
 * (13-RESEARCH.md Pitfall 3): "an error page rendered" alone would prove
 * nothing about whether a session was actually issued underneath it.
 *
 * Confirmed against the installed `better-auth@1.6.23` source
 * (`dist/db/internal-adapter.mjs`'s `consumeVerificationValue`): the
 * `verification` table's `identifier` column is the RAW, unhashed token
 * string (this app configures no `magicLink({ storeToken })` /
 * `verification.storeIdentifier` option, so `processIdentifier` is a
 * no-op passthrough) — this is what makes the expired-token case's direct
 * `prisma.verification.updateMany({ where: { identifier: token }, ... })`
 * manipulation target the exact right row. `consumeVerificationValue` also
 * unconditionally DELETES the matching row on first use (`deleteMany` right
 * after `consumeOne`) before checking `expiresAt` — so a first-use consumed
 * token and a genuinely-expired token both fail via the SAME
 * `INVALID_TOKEN` -> `errorCallbackURL` redirect path; the malformed-token
 * case fails even earlier (no matching row is ever found).
 *
 * Each case navigates in a FRESH, cookie-less `BrowserContext` (never the
 * test's own `page`/`context`, whose cookie jar may already carry state
 * from that same test's own earlier setup step) so "no session" is proven
 * from a genuinely cold client, not merely "this already-authenticated
 * client didn't gain anything new."
 *
 * All magic-link requests here send the INFRA-06 `x-e2e-bypass` header, so
 * this spec never contends the shared IP rate-limit bucket AUTH-E2E-07
 * (13-06) deliberately trips (T-13-06).
 */

/** Dedicated allowlisted email for this file only — never `ADMIN_EMAIL`/
 * `MEMBER_EMAIL` (owned by the `setup` project) and never reused by any
 * other spec in this phase. */
const EMAIL = `token-reject-${randomUUID().slice(0, 8)}@e2e.zack.local`;

async function requestMagicLink(request: APIRequestContext, email: string): Promise<void> {
  const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
  const response = await request.post("/api/auth/sign-in/magic-link", {
    data: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
    headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
  });
  expect(response.ok()).toBeTruthy();
}

test.describe.serial("AUTH-E2E-02: magic-link token rejection (consumed / expired / malformed)", () => {
  let prisma: PrismaClient;

  test.beforeAll(async () => {
    prisma = createE2ePrisma();
    await createAllowlistedUser(prisma, { email: EMAIL });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("consumed-token reuse is rejected — a second verify attempt creates no session", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    await requestMagicLink(request, EMAIL);
    const magicLinkUrl = await findMagicLinkUrl(EMAIL);

    // Consume the token once via this test's OWN page — a real session is
    // established (verified independently, not just "no error appeared").
    await page.goto(magicLinkUrl);
    await page.getByRole("link", { name: "Dashboard" }).waitFor();
    // Narrow rate-limit bypass (INFRA-06) for these ASSERTION-ONLY session
    // checks — this spec's subject is token rejection, not rate-limiting.
    const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    const bypassHeaders: Record<string, string> | undefined = bypassSecret
      ? { "x-e2e-bypass": bypassSecret }
      : undefined;
    const firstSession = await page.request.get("/api/auth/get-session", { headers: bypassHeaders });
    expect(((await firstSession.json()) as { user?: { email?: string } } | null)?.user?.email).toBe(EMAIL);

    // Second, fresh, cookie-less context: the SAME token is already
    // consumed (deleted from `verification`) — better-auth must reject it.
    const freshContext = await browser.newContext({
      baseURL: baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    });
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto(magicLinkUrl);
      await expect(freshPage).toHaveURL(/\/auth\/error/);

      const sessionResponse = await freshPage.request.get("/api/auth/get-session", { headers: bypassHeaders });
      expect(await sessionResponse.json()).toBeNull();
    } finally {
      await freshContext.close();
    }
  });

  test("DB-expired token is rejected — no session created (no real 15-minute wait)", async ({
    request,
    browser,
    baseURL,
  }) => {
    await requestMagicLink(request, EMAIL);
    const magicLinkUrl = await findMagicLinkUrl(EMAIL);
    const token = new URL(magicLinkUrl).searchParams.get("token");
    if (!token) {
      throw new Error(`Could not extract a "token" query param from magic-link URL: ${magicLinkUrl}`);
    }

    // Directly expire the corresponding `verification` row — deterministic,
    // no real wait for the 15-minute (`expiresIn: 900`) window to elapse.
    await prisma.verification.updateMany({
      where: { identifier: token },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const freshContext = await browser.newContext({
      baseURL: baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    });
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto(magicLinkUrl);
      await expect(freshPage).toHaveURL(/\/auth\/error/);

      // Narrow rate-limit bypass (INFRA-06) — this spec's subject is token
      // rejection, not rate-limiting.
      const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
      const sessionResponse = await freshPage.request.get("/api/auth/get-session", {
        headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
      });
      expect(await sessionResponse.json()).toBeNull();
    } finally {
      await freshContext.close();
    }
  });

  test("malformed/tampered token is rejected — no session created", async ({ browser, baseURL }) => {
    const resolvedBaseUrl = baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
    const malformedUrl =
      `${resolvedBaseUrl}/api/auth/magic-link/verify?token=not-a-real-token-deadbeef` +
      `&callbackURL=${encodeURIComponent("/")}&errorCallbackURL=${encodeURIComponent("/auth/error")}`;

    const freshContext = await browser.newContext({ baseURL: resolvedBaseUrl });
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto(malformedUrl);
      await expect(freshPage).toHaveURL(/\/auth\/error/);

      // Narrow rate-limit bypass (INFRA-06) — this spec's subject is token
      // rejection, not rate-limiting.
      const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
      const sessionResponse = await freshPage.request.get("/api/auth/get-session", {
        headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
      });
      expect(await sessionResponse.json()).toBeNull();
    } finally {
      await freshContext.close();
    }
  });
});
