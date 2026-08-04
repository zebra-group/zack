/**
 * Account-role session propagation + admin-seed idempotency suite (Phase 9,
 * D-09-01, UI-09-02) — proves the two runtime-observable halves of Task 2:
 *
 * 1. `seedInitialAdmin` always leaves the seeded operator `accountRole:
 *    "admin"`, on both a fresh create and a re-run against an already-seeded
 *    row (never demotes — the D-09-07 lockout precondition).
 * 2. better-auth's `GET /api/auth/get-session` response for that signed-in
 *    admin carries `user.accountRole: "admin"` — the `user.additionalFields`
 *    wiring in `lib/auth.ts` (UI-09-02's data-contract requirement).
 *
 * Reuses `auth.integration.test.ts`'s exact magic-link round-trip shape
 * (request -> extract token -> verify -> cookie -> get-session) against the
 * same `setupFileEach.ts` transaction-wrapped real-Postgres harness.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { seedInitialAdmin } from "../src/lib/admin-seed.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const ADMIN_EMAIL = "account-role-session-admin@zack.test";

/** Extracts the `token` query param from a captured magic-link verify URL. */
function extractToken(magicLinkUrl: string): string {
  const token = new URL(magicLinkUrl).searchParams.get("token");
  if (!token) {
    throw new Error(`No token found in magic-link URL: ${magicLinkUrl}`);
  }
  return token;
}

/** Joins one or more raw `Set-Cookie` headers into a single `Cookie` header value. */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/**
 * Requests a magic link for `email`, verifies it, and returns the resulting
 * session cookie header — the same request+verify shape
 * `auth.integration.test.ts` establishes, factored here as the reusable
 * "sign in as" step this suite's tests share.
 */
async function signInAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
  });
  const call = vi.mocked(sendMagicLinkEmail).mock.calls.at(-1);
  const magicLinkUrl = call?.[0]?.url;
  if (!magicLinkUrl) {
    throw new Error(`sendMagicLinkEmail was not called for ${email}`);
  }
  const token = extractToken(magicLinkUrl);

  const verifyRes = await app.inject({
    method: "GET",
    url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  });
  return toCookieHeader(verifyRes.headers["set-cookie"]);
}

describe("Account-role session propagation + admin-seed idempotency (D-09-01, UI-09-02)", () => {
  beforeEach(() => {
    vi.mocked(sendMagicLinkEmail).mockClear();
  });

  it("seedInitialAdmin creates a fresh admin with accountRole=admin", async () => {
    await seedInitialAdmin(prisma, ADMIN_EMAIL);

    const user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    expect(user?.accountRole).toBe("admin");
  });

  it("seedInitialAdmin re-run against an already-seeded row re-affirms accountRole=admin (idempotent)", async () => {
    await seedInitialAdmin(prisma, ADMIN_EMAIL);
    const first = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    expect(first?.accountRole).toBe("admin");

    await seedInitialAdmin(prisma, ADMIN_EMAIL);
    const second = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    expect(second?.accountRole).toBe("admin");
    expect(second?.id).toBe(first?.id);
  });

  it("GET /api/auth/get-session for the signed-in seeded admin returns user.accountRole=admin", async () => {
    await seedInitialAdmin(prisma, ADMIN_EMAIL);
    const app = await buildApp({ prisma });

    const cookieHeader = await signInAs(app, ADMIN_EMAIL);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie: cookieHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(ADMIN_EMAIL);
    expect(body.user.accountRole).toBe("admin");

    await app.close();
  });
});
