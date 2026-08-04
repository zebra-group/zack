/**
 * E2E fixture helper for `Link` rows (12-02-PLAN.md, REDIRECT-E2E-01..05).
 *
 * `@zack/api`'s `package.json` `exports` map declares exactly two entries
 * (`.` -> `./dist/server.js`, `./prisma-client` -> the generated Prisma
 * client) — `lib/links.ts`'s `createLink`/`updateLink` (the codebase's SOLE
 * `prisma.link.create`/`prisma.link.update` call sites, D-01) are NOT
 * exported and therefore structurally unreachable from `apps/e2e`
 * (12-RESEARCH.md Q2, RESOLVED). Every feature spec in this phase still
 * needs to seed Link fixtures, so this module provides a raw-insert
 * `createE2eLink` that deliberately mirrors the SHAPE of two of
 * `lib/links.ts`'s pure derivation functions — `derivePasswordHash` and
 * `deriveExpiresAt` — byte-for-byte, so a fixture Link stores exactly the
 * same invariants `createLink` would have enforced:
 *
 *   - `passwordHash` is a REAL bcrypt hash (never plaintext), so
 *     `POST /:slug/verify`'s `bcrypt.compare` can succeed against it.
 *   - `expiresAt` is the UTC end-of-day instant of the given date, matching
 *     `resolveLinkState`'s expiry precedence (D-14) exactly.
 *
 * This module deliberately does NOT reproduce `lib/links.ts`'s
 * authorization/validation core (`validateLinkInput`, `requireDomainAccess`,
 * slug-shape/reserved-word checks, UTM/OG length limits, etc.) — this
 * phase's specs are proving the PUBLIC redirect handler's behavior, not
 * re-testing Link-write authorization (that's the v1.0 Denial-Suite's job,
 * out of scope per REQUIREMENTS.md). Every spec must still supply its own
 * cryptographically-random slug (12-RESEARCH.md Pattern 3) for
 * `fullyParallel` safety.
 */
import { expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "@zack/api/prisma-client";
import { ADMIN_EMAIL, BASELINE_DOMAIN_HOSTNAME } from "./db.js";

/** Accepts either a top-level PrismaClient or a `withResetDbLock` transaction client. */
type E2ePrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * bcrypt hash cost — mirrors `apps/api/src/lib/links.ts`'s
 * `resolvePasswordHashCost`: reads `process.env.PASSWORD_HASH_COST`
 * directly (no ENV-schema dependency), falling back to the same default
 * (11) `env.ts`'s `PASSWORD_HASH_COST` schema key documents.
 */
const PASSWORD_HASH_COST_DEFAULT = 11;
function resolvePasswordHashCost(): number {
  const raw = Number(process.env.PASSWORD_HASH_COST);
  return Number.isInteger(raw) && raw > 0 ? raw : PASSWORD_HASH_COST_DEFAULT;
}

/**
 * Hashes `plaintext` with bcrypt at the resolved cost — mirrors
 * `apps/api/src/lib/links.ts`'s `derivePasswordHash` SHAPE for the
 * "set a password" case (this fixture helper never needs the
 * keep/clear/undefined three-state derivation `createLink`/`updateLink`
 * support, since every fixture call either sets a password or doesn't).
 */
export async function derivePasswordHash(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, resolvePasswordHashCost());
}

/**
 * Derives the UTC end-of-day expiry instant for a `YYYY-MM-DD` date string —
 * mirrors `apps/api/src/lib/links.ts`'s `deriveExpiresAt` exactly
 * (`${date}T23:59:59.999Z`).
 */
export function deriveExpiresAt(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

export type CreateE2eLinkOptions = {
  slug: string;
  targetUrl: string;
  /** Defaults to `BASELINE_DOMAIN_HOSTNAME` (`e2e.zack.local`) — this phase never seeds a second Domain. */
  domainHostname?: string;
  /** Plaintext password to hash via `derivePasswordHash`; omitted -> `passwordHash: null` (not protected). */
  password?: string;
  /** `YYYY-MM-DD` date to derive via `deriveExpiresAt`; omitted -> `expiresAt: null` (never expires). */
  expiresAt?: string;
  forwardQuery?: boolean;
  trackingEnabled?: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
};

/**
 * Raw-insert Link fixture helper (12-RESEARCH.md Pitfall 4). Resolves
 * `domainId` from `opts.domainHostname ?? BASELINE_DOMAIN_HOSTNAME` and
 * `createdBy` from the seeded `ADMIN_EMAIL` User (both already exist per
 * `apps/e2e/src/db.ts`'s `seedBaseline`), hashes `opts.password` when
 * supplied (else `null`), derives `opts.expiresAt` when supplied (else
 * `null`), and passes the remaining owner-configurable fields through
 * verbatim.
 */
export async function createE2eLink(prisma: E2ePrismaLike, opts: CreateE2eLinkOptions) {
  const [domain, admin] = await Promise.all([
    prisma.domain.findUniqueOrThrow({
      where: { hostname: opts.domainHostname ?? BASELINE_DOMAIN_HOSTNAME },
    }),
    prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } }),
  ]);

  const passwordHash = opts.password !== undefined ? await derivePasswordHash(opts.password) : null;
  const expiresAt = opts.expiresAt !== undefined ? deriveExpiresAt(opts.expiresAt) : null;

  return prisma.link.create({
    data: {
      domainId: domain.id,
      slug: opts.slug,
      targetUrl: opts.targetUrl,
      createdBy: admin.id,
      passwordHash,
      expiresAt,
      forwardQuery: opts.forwardQuery,
      trackingEnabled: opts.trackingEnabled,
      utmSource: opts.utmSource,
      utmMedium: opts.utmMedium,
      utmCampaign: opts.utmCampaign,
      ogTitle: opts.ogTitle,
      ogDescription: opts.ogDescription,
      ogImageUrl: opts.ogImageUrl,
    },
  });
}

/**
 * Shared redirect-test vocabulary (12-RESEARCH.md "Reusing the integration
 * test's exact fixture builder shape") — reused VERBATIM from
 * `apps/api/test/redirect.integration.test.ts` so every feature spec in
 * this phase pins the SAME real bot/browser UA strings and no-leak canary,
 * rather than each re-deriving (and risking drift from) its own.
 */
export const CANARY_TARGET = "https://canary-leak-marker.example.net/super-secret-target-xyz123";
export const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/**
 * Asserts `canary` appears in NEITHER the response body NOR any header
 * value — adapted from `redirect.integration.test.ts`'s `assertNoLeak` to
 * Playwright's `APIResponse` shape (a plain string body via `.text()`, a
 * plain `Record<string, string>` via `.headers()`), rather than
 * `fastify.inject`'s synchronous body/headers.
 */
export function assertNoLeak(body: string, headers: Record<string, string>, canary: string): void {
  expect(body).not.toContain(canary);
  for (const value of Object.values(headers)) {
    expect(String(value ?? "")).not.toContain(canary);
  }
}

/**
 * Retries a "create a fresh fixture Link, then issue the real HTTP request
 * that reads it back" cycle up to `maxAttempts` times, whenever the response
 * doesn't match `isExpected` (12-03-PLAN.md deviation, Rule 1 bug fix,
 * discovered running the full-suite per-wave-merge gate).
 *
 * `apps/e2e/tests/smoke/db-isolation.spec.ts` runs 6 concurrent
 * `withResetDbLock` cycles that each `TRUNCATE ... "Link" ...
 * RESTART IDENTITY CASCADE` (RESEARCH Pattern 3) from a DIFFERENT spec file
 * under this project's `fullyParallel: true` config. A plain
 * `createE2eLink` immediately followed by a real HTTP GET can lose its
 * just-created row to that sibling file's truncate/reseed between the two
 * steps — empirically observed as an intermittent 404 where a 302/410 was
 * expected when running the FULL suite (isolated single-file runs never hit
 * this, since nothing else is truncating `Link` concurrently).
 *
 * A transaction-scoped advisory lock (`withResetDbLock`) cannot fix this for
 * an HTTP-round-trip test: the created row must be visible to the APP
 * SERVER's own database connection, which — under Postgres's default READ
 * COMMITTED isolation — cannot see a row still held inside another
 * connection's open transaction. Retrying with a BRAND-NEW fixture is the
 * pragmatic, connection-agnostic fix: each attempt's `create` closure mints
 * its own random slug, so a retry can never collide with the previous
 * attempt's (possibly-truncated) row.
 *
 * Generic over `T` (12-REVIEW.md WR-01) rather than pinned to Playwright's
 * `APIResponse`, so this same helper protects BOTH request-context calls
 * (`request.get`/`page.request.post`, which resolve `APIResponse`) AND real
 * browser navigations (`page.goto`, which resolves `playwright.Response |
 * null`) — `redirect-password-gate.spec.ts` needs the latter shape and,
 * before this change, had no compatible overload to reach for.
 *
 * `options.onDiscardedAttempt` and the `console.warn` below close
 * 12-REVIEW.md WR-03: previously a failed attempt's response was silently
 * thrown away, which meant (a) a retry firing because of a genuinely NEW,
 * unrelated regression looked identical in CI output to the documented
 * truncate race firing, and (b) for the no-leak specs specifically, a
 * discarded intermediate response's body/headers were never inspected — a
 * real leak on attempt 1 could hide behind a clean attempt 2. `console.warn`
 * always surfaces a retry (attempt number + best-effort status); passing
 * `onDiscardedAttempt` lets a caller (e.g. `assertNoLeak`) additionally run
 * its OWN checks against every discarded attempt, not only the one that
 * finally matched `isExpected`.
 */
export async function fetchWithFixtureRaceRetry<T>(
  attempt: () => Promise<T>,
  isExpected: (response: T) => boolean,
  maxAttempts = 3,
  options?: {
    /**
     * Invoked for every attempt that does NOT match `isExpected`, right
     * after that attempt is discarded (including the final, exhausted
     * attempt). Use this to still assert security-sensitive invariants
     * (e.g. `assertNoLeak`) against a response this function itself never
     * returns to the caller.
     */
    onDiscardedAttempt?: (response: T, attemptNumber: number) => void | Promise<void>;
    /** Included in the `console.warn` emitted on every retry, so multi-callsite CI output is attributable to a specific spec/test. */
    label?: string;
  },
): Promise<T> {
  let response: T | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    response = await attempt();
    if (isExpected(response)) return response;

    const attemptNumber = i + 1;
    const willRetry = attemptNumber < maxAttempts;
    // WR-03: log every discarded attempt so CI output can distinguish "the
    // documented db-isolation truncate race fired" from a genuinely
    // flaky/regressed response, instead of silently swallowing it.
    console.warn(
      `[fetchWithFixtureRaceRetry${options?.label ? `:${options.label}` : ""}] attempt ${attemptNumber}/${maxAttempts} returned status ${describeResponseStatus(response)}, not the expected response — ${
        willRetry ? "retrying with a fresh fixture" : "exhausted retries, returning the last response"
      }`,
    );
    if (options?.onDiscardedAttempt) {
      await options.onDiscardedAttempt(response, attemptNumber);
    }
  }
  return response as T;
}

/**
 * Best-effort status extraction for the `console.warn` above. Every real
 * caller passes a Playwright `APIResponse` or page-navigation `Response`
 * (both expose a synchronous `.status()`), but this stays defensive against
 * `null` (a real, documented `page.goto` return type) or any other shape
 * rather than throwing from inside a diagnostic log line.
 */
function describeResponseStatus(response: unknown): string {
  if (response && typeof (response as { status?: unknown }).status === "function") {
    try {
      return String((response as { status: () => number }).status());
    } catch {
      return "<status() threw>";
    }
  }
  return "<no status()>";
}
