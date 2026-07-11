/**
 * Regression coverage for WR-06 (04-REVIEW.md): the auto-generated-slug
 * branch of `resolveSlug` (lib/links.ts) must also skip a candidate that
 * collides with `RESERVED_SLUGS`, not only check for a DB collision.
 *
 * `generateSlug` is normally random (`customAlphabet(BASE62, 7)`), which
 * makes forcing a reserved-word collision from outside impossible without
 * dependency injection. This file mocks the `nanoid` package (the ONLY
 * file in the suite that does — isolated to this file so no other test's
 * "random-looking" slug assertions are affected) so the very first
 * generated candidate is deterministically `"domains"` — a real
 * `RESERVED_SLUGS` entry that is exactly 7 characters (the same length
 * `generateSlug` produces) and lowercase-alphabetic (a valid Base62
 * output shape) — proving the retry loop treats it as a collision and
 * moves on to a real slug instead of ever returning it. `vi.mock` calls
 * are hoisted above all imports by Vitest's transform, so this works
 * despite `generateSlug` being created at lib/links.ts's module-load time.
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test), mirroring
 * links.integration.test.ts's magic-link -> verify -> cookie flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { seedInitialAdmin } from "../src/lib/admin-seed.js";
import { validateLinkInput } from "../src/lib/links.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

const RESERVED_CANDIDATE = "domains"; // 7 chars, lowercase-alphabetic, a real RESERVED_SLUGS entry.
const FALLBACK_CANDIDATE = "zZ9xQ7w"; // 7 chars, valid Base62 shape, NOT reserved.

let nanoidCallCount = 0;

vi.mock("nanoid", () => ({
  customAlphabet: () => () => {
    nanoidCallCount += 1;
    return nanoidCallCount === 1 ? RESERVED_CANDIDATE : FALLBACK_CANDIDATE;
  },
}));

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const OWNER_EMAIL = "auto-slug-reserved-owner@kurzly.test";

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

/** Requests a magic link for `email` and returns the captured verify URL. */
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

/** Signs `email` in via the full magic-link round trip and returns a Cookie header. */
async function signInAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  const magicLinkUrl = await requestMagicLinkUrl(app, email);
  const token = extractToken(magicLinkUrl);
  const verifyRes = await app.inject({
    method: "GET",
    url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  });
  return toCookieHeader(verifyRes.headers["set-cookie"]);
}

/** Resolves the userId behind an already-signed-in cookie header. */
async function resolveSessionUserId(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookieHeader: string,
): Promise<string> {
  const session = await app.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie: cookieHeader },
  });
  return session.json()?.user?.id as string;
}

/** Creates a Domain + owner DomainMembership for `userId` directly via Prisma (test seed helper). */
async function seedOwnedDomain(userId: string, hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.kurzly.local",
    },
  });
  await prisma.domainMembership.create({
    data: { userId, domainId: domain.id, role: "owner" },
  });
  return domain.id;
}

describe("Auto-generated slug reserved-word retry (WR-06, 04-REVIEW.md)", () => {
  beforeEach(async () => {
    vi.mocked(sendMagicLinkEmail).mockClear();
    nanoidCallCount = 0;
    await seedInitialAdmin(prisma, OWNER_EMAIL);
  });

  it("retries past a reserved-word auto-generated candidate instead of ever returning it", async () => {
    const app = await buildApp({ prisma });
    const ownerCookie = await signInAs(app, OWNER_EMAIL);
    const ownerId = await resolveSessionUserId(app, ownerCookie);
    const domainId = await seedOwnedDomain(ownerId, "auto-slug-reserved.example.com");

    const result = await validateLinkInput(prisma, {
      userId: ownerId,
      domainId,
      targetUrl: "https://example.com",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.slug).not.toBe(RESERVED_CANDIDATE);
      expect(result.data.slug).toBe(FALLBACK_CANDIDATE);
    }
    // Proves the retry actually happened (first candidate rejected, second accepted).
    expect(nanoidCallCount).toBe(2);

    await app.close();
  });
});
