/**
 * Magic-link authentication integration suite (AUTH-01..04, D-01 neutral
 * response, RESEARCH OQ-1/OQ-3) — the real completion evidence for those
 * requirements per 02-02-SUMMARY.md ("no route is mounted yet" there).
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test) via `buildApp({ prisma
 * })` — the same pattern `authorization.test.ts` and
 * `server.integration.test.ts` already establish (D-09). Nothing about
 * better-auth's own token issuance/consumption/session lifecycle or the
 * `isEmailAllowed` allowlist gate is mocked — only `lib/mailer.ts`'s
 * `sendMagicLinkEmail` is replaced with a spy, so the magic-link URL/token
 * can be captured without a real SMTP send (no Mailpit container dependency
 * in unit CI, per this plan's stated preference).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { seedInitialAdmin } from "../src/lib/admin-seed.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const ADMIN_EMAIL = "admin@zack.test";
const NEVER_SEEN_EMAIL = "never-allowlisted@zack.test";

/** Joins one or more raw `Set-Cookie` headers into a single `Cookie` header value. */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/** Extracts the `token` query param from a captured magic-link verify URL. */
function extractToken(magicLinkUrl: string): string {
  const token = new URL(magicLinkUrl).searchParams.get("token");
  if (!token) {
    throw new Error(`No token found in magic-link URL: ${magicLinkUrl}`);
  }
  return token;
}

/**
 * Requests a magic link for `email` and returns the captured verify URL.
 *
 * Sends `callbackURL`/`errorCallbackURL` (CR-02) mirroring the real client
 * request (`apps/web/src/views/LoginView.vue`'s `sendMagicLink()`) — without
 * these, better-auth's verify endpoint falls back to `callbackURL`
 * (default "/") for BOTH success and failure, which is exactly the bug
 * CR-02 fixes and would make the negative-path assertions below pass
 * vacuously against the pre-fix behavior.
 */
async function requestMagicLinkUrl(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
  });
  const call = vi.mocked(sendMagicLinkEmail).mock.calls.at(-1);
  const url = call?.[0]?.url;
  if (!url) {
    throw new Error(`sendMagicLinkEmail was not called for ${email}`);
  }
  return url;
}

describe("Magic-link authentication (AUTH-01..04, D-01 neutral response)", () => {
  beforeEach(async () => {
    vi.mocked(sendMagicLinkEmail).mockClear();
    await seedInitialAdmin(prisma, ADMIN_EMAIL);
  });

  it("AUTH-01: requesting a magic link for the allowlisted admin email sends mail", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      payload: { email: ADMIN_EMAIL },
    });

    expect(res.statusCode).toBe(200);
    expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1);
    expect(sendMagicLinkEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ADMIN_EMAIL,
        url: expect.stringContaining("/magic-link/verify"),
      }),
    );

    await app.close();
  });

  it("D-01: allowlisted vs never-seen email return a byte-identical response; mail sent only for the allowlisted one", async () => {
    const app = await buildApp({ prisma });

    const res1 = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      payload: { email: ADMIN_EMAIL },
    });
    expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1);
    vi.mocked(sendMagicLinkEmail).mockClear();

    const res2 = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      payload: { email: NEVER_SEEN_EMAIL },
    });

    expect(res2.statusCode).toBe(res1.statusCode);
    expect(res2.body).toBe(res1.body);
    expect(sendMagicLinkEmail).not.toHaveBeenCalled();

    await app.close();
  });

  it("AUTH-02: a valid, unused token signs the seeded admin in (Pitfall 1 proven) and sets an httpOnly session cookie", async () => {
    const app = await buildApp({ prisma });

    const magicLinkUrl = await requestMagicLinkUrl(app, ADMIN_EMAIL);
    const token = extractToken(magicLinkUrl);

    const res = await app.inject({
      method: "GET",
      url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
    });

    // No callbackURL was supplied — better-auth's verify endpoint returns
    // the session as JSON directly (no redirect) in that case.
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(ADMIN_EMAIL);

    const rawSetCookie = res.headers["set-cookie"];
    expect(rawSetCookie).toBeDefined();
    const rawCookies = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
    expect(rawCookies.some((cookie) => /httponly/i.test(cookie ?? ""))).toBe(true);
    // IN-02: `SameSite=Lax` is unconditional in better-auth's cookie
    // defaults (dist/cookies/index.mjs) — assert it so a future config
    // change (or a better-auth major bump) fails this test instead of
    // silently shipping a weaker default.
    expect(rawCookies.some((cookie) => /samesite=lax/i.test(cookie ?? ""))).toBe(true);
    // `Secure` is NOT asserted here: better-auth derives it from whether
    // `BASE_URL` starts with "https://" (same source file) — this test
    // suite's `BASE_URL` is `http://localhost:3000` (vitest.config.ts's
    // test env, mirroring local dev), so `Secure` is correctly absent in
    // THIS environment. Confirmed empirically: the raw header here is
    // `...; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax` with no
    // `Secure` token. Asserting `Secure` present would be a false claim
    // about this test's own config, not a regression guard — the
    // `BASE_URL`->`Secure` derivation is better-auth's own behavior, not
    // this codebase's, and isn't re-tested here.
    expect(rawCookies.some((cookie) => /;\s*secure(;|$)/i.test(cookie ?? ""))).toBe(false);

    await app.close();
  });

  it("AUTH-02 negative: an invalid/never-issued token does not sign in, leaks nothing, and lands on the D-05 error screen (CR-02)", async () => {
    const app = await buildApp({ prisma });

    // A genuine (tampered/typo'd/expired) magic-link URL always carries the
    // errorCallbackURL query param the client requested (CR-02) — mirror
    // that here rather than testing a URL shape that never occurs in the
    // real flow.
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/magic-link/verify?token=totally-bogus-token-that-was-never-issued&errorCallbackURL=%2Fauth%2Ferror",
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("error=INVALID_TOKEN");
    // CR-02 regression: assert the actual redirect PATH, not just a
    // substring of the query string — a substring check passes whether the
    // redirect lands on /auth/error (correct, D-05) or on / (the bug: the
    // router guard then silently bounces to /login with no explanation and
    // AuthErrorView.vue is never reached).
    expect(new URL(res.headers.location as string, "http://localhost").pathname).toBe(
      "/auth/error",
    );
    expect(res.headers["set-cookie"]).toBeUndefined();

    await app.close();
  });

  it("AUTH-02 negative: an already-used token cannot sign in a second time (single-use enforcement) and lands on the D-05 error screen (CR-02)", async () => {
    const app = await buildApp({ prisma });

    const magicLinkUrl = await requestMagicLinkUrl(app, ADMIN_EMAIL);
    // Preserve the FULL emailed URL (including the errorCallbackURL query
    // param better-auth embedded per CR-02's fixed sign-in request), not
    // just the bare token — reconstructing from `token` alone would silently
    // drop errorCallbackURL and test the pre-fix fallback behavior instead.
    const parsedMagicLinkUrl = new URL(magicLinkUrl);
    const verifyUrl = `${parsedMagicLinkUrl.pathname}${parsedMagicLinkUrl.search}`;

    const first = await app.inject({ method: "GET", url: verifyUrl });
    // With `callbackURL` supplied (CR-02), a successful verify redirects to
    // it instead of returning the session as JSON directly (contrast with
    // the AUTH-02 positive test above, which omits callbackURL).
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).not.toContain("error=");
    expect(first.headers["set-cookie"]).toBeDefined();

    const second = await app.inject({ method: "GET", url: verifyUrl });
    expect(second.statusCode).toBe(302);
    expect(second.headers.location).toContain("error=INVALID_TOKEN");
    expect(new URL(second.headers.location as string, "http://localhost").pathname).toBe(
      "/auth/error",
    );
    expect(second.headers["set-cookie"]).toBeUndefined();

    await app.close();
  });

  it("AUTH-03: session survives repeated getSession() calls (simulated browser refresh)", async () => {
    const app = await buildApp({ prisma });

    const magicLinkUrl = await requestMagicLinkUrl(app, ADMIN_EMAIL);
    const token = extractToken(magicLinkUrl);
    const verifyRes = await app.inject({
      method: "GET",
      url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
    });
    const cookieHeader = toCookieHeader(verifyRes.headers["set-cookie"]);

    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie: cookieHeader },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()?.user?.email).toBe(ADMIN_EMAIL);
    }

    await app.close();
  });

  it("AUTH-04: sign-out clears the session; a subsequent getSession is unauthenticated", async () => {
    const app = await buildApp({ prisma });

    const magicLinkUrl = await requestMagicLinkUrl(app, ADMIN_EMAIL);
    const token = extractToken(magicLinkUrl);
    const verifyRes = await app.inject({
      method: "GET",
      url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
    });
    const cookieHeader = toCookieHeader(verifyRes.headers["set-cookie"]);

    const authenticatedCheck = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie: cookieHeader },
    });
    expect(authenticatedCheck.json()?.user?.email).toBe(ADMIN_EMAIL);

    const signOutRes = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie: cookieHeader },
    });
    expect(signOutRes.statusCode).toBe(200);

    const afterRes = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie: cookieHeader },
    });
    expect(afterRes.statusCode).toBe(200);
    expect(afterRes.json()).toBeNull();

    await app.close();
  });
});
