/**
 * E2E DB helper (INFRA-03, T-11-03, T-11-06) — a reused Prisma client
 * against the published `:5433` E2E Postgres, a least-privilege baseline
 * seed, and an FK-safe, advisory-locked truncate/reseed for per-spec-file
 * isolation.
 *
 * Deliberately imports the SAME generated Prisma client `apps/api` ships
 * via its `./prisma-client` subpath export (11-RESEARCH.md's "Prisma
 * Client Subpath Export" section, OQ-1/A1 — already proven to resolve
 * under Playwright's runtime by `tests/smoke/prisma-import.spike.spec.ts`
 * in Wave 0) rather than duplicating `schema.prisma` or hand-rolling raw
 * SQL against a second driver — `apps/e2e` stays a pure Prisma consumer,
 * never re-generating a client of its own.
 *
 * `@prisma/adapter-pg` is required here for the exact reason
 * `apps/api/src/db.ts` documents: Prisma 7.8.0's `PrismaClientOptions`
 * requires either a driver `adapter` or an `accelerateUrl` — plain
 * `new PrismaClient()` no longer type-checks.
 */
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@zack/api/prisma-client";

/** Seeded admin User (accountRole "admin"). Matches
 * `docker-compose.e2e.yml`'s `INITIAL_ADMIN_EMAIL` so this row also passes
 * the app's own boot-time admin-seed idempotently. */
export const ADMIN_EMAIL = "admin@e2e.kurzly.local";

/** Seeded least-privilege Member User (accountRole "member", exactly one
 * DomainMembership at role "member" — T-11-03: never account-admin, never
 * an extra membership "for convenience"). */
export const MEMBER_EMAIL = "member@e2e.kurzly.local";

/** Baseline seeded Domain's hostname, reused by downstream specs/fixtures
 * needing a domain-scoped Link/QR fixture without re-seeding a Domain. */
export const BASELINE_DOMAIN_HOSTNAME = "e2e.kurzly.local";

/**
 * Fixed integer key for `pg_advisory_xact_lock` around
 * `withResetDbLock`'s truncate+reseed sequence (RESEARCH Pitfall 4) —
 * arbitrary but stable across the whole E2E suite so two parallel worker
 * spec files can never interleave their truncate/reseed against each other.
 */
const RESET_DB_ADVISORY_LOCK_KEY = 424_242;

/**
 * Creates a Prisma client bound to `E2E_DATABASE_URL` (the compose-published
 * `:5433` Postgres, see `scripts/e2e-compose.sh`) via `@prisma/adapter-pg`.
 * Throws a clear error if `E2E_DATABASE_URL` is unset rather than letting
 * Prisma fail later with an opaque connection error.
 */
export function createE2ePrisma(): PrismaClient {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "E2E_DATABASE_URL is not set — apps/e2e/src/db.ts must only be used " +
        "inside the E2E harness (see scripts/e2e-compose.sh, which exports " +
        "this variable before running the Playwright suite).",
    );
  }
  const adapter = new PrismaPg(databaseUrl);
  return new PrismaClient({ adapter });
}

/**
 * Idempotent (upsert) baseline seed, run once per suite from
 * `global-setup.ts`: one active Domain, one admin User (`accountRole:
 * "admin"`, `emailVerified: true`), one Member User (`accountRole:
 * "member"`, `emailVerified: true`) with exactly one DomainMembership at
 * role `"member"` on that Domain (T-11-03 — the Member fixture must be
 * genuinely least-privilege, never account-admin, never an extra
 * membership).
 */
export async function seedBaseline(prisma: PrismaClient): Promise<void> {
  const domain = await prisma.domain.upsert({
    where: { hostname: BASELINE_DOMAIN_HOSTNAME },
    update: { status: "active" },
    create: {
      hostname: BASELINE_DOMAIN_HOSTNAME,
      type: "subdomain",
      status: "active",
      verificationTarget: BASELINE_DOMAIN_HOSTNAME,
    },
  });

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { emailVerified: true, accountRole: "admin" },
    create: {
      id: randomUUID(),
      name: "E2E Admin",
      email: ADMIN_EMAIL,
      emailVerified: true,
      accountRole: "admin",
    },
  });

  const member = await prisma.user.upsert({
    where: { email: MEMBER_EMAIL },
    update: { emailVerified: true, accountRole: "member" },
    create: {
      id: randomUUID(),
      name: "E2E Member",
      email: MEMBER_EMAIL,
      emailVerified: true,
      accountRole: "member",
    },
  });

  await prisma.domainMembership.upsert({
    where: { userId_domainId: { userId: member.id, domainId: domain.id } },
    update: { role: "member" },
    create: { userId: member.id, domainId: domain.id, role: "member" },
  });
}

/**
 * FK-safe, advisory-locked truncate + reseed of the file-scoped mutable
 * tables (RESEARCH Pattern 3): `QrRemapHistory -> QrCode -> ClickEvent ->
 * Link -> DomainMembership`, `RESTART IDENTITY CASCADE`. Deliberately never
 * truncates `User`/`Domain`/`Session`/`Account`/`Verification` — truncating
 * `Session` mid-run would invalidate every spec project's saved
 * `storageState` (T-11-06). Uses the reused Prisma client's own
 * `$executeRawUnsafe` (no second `pg` driver dependency, per RESEARCH
 * "Don't Hand-Roll").
 *
 * IN-02 (11-REVIEW.md iteration 2): this used to be a separate `resetDb()`
 * export with its own truncate-only critical section, plus this function as
 * a "widened" variant for callers needing to also cover their own
 * create/read (CR-04). The CR-04 fix rewrote `db-isolation.spec.ts` — the
 * ONLY caller either function ever had — to always need the widened
 * critical section, leaving the truncate-only `resetDb()` with zero callers
 * anywhere in the codebase. Removed rather than kept as unused public API;
 * reintroduce a narrower truncate-only export here if a future spec
 * genuinely needs the reset without sharing the lock's critical section
 * with its own writes.
 *
 * Wrapped in a single `$transaction` using `pg_advisory_xact_lock`
 * (CR-03, 11-REVIEW.md) — the previous implementation issued
 * `pg_advisory_lock`/`pg_advisory_unlock` as three independent
 * `$executeRawUnsafe` calls, with no guarantee `@prisma/adapter-pg`'s
 * underlying `pg` connection pool routed all three to the SAME backend
 * session. Session-scoped advisory locks are held/released per-connection,
 * so the lock could silently provide zero mutual exclusion if the pool
 * handed out different connections for the lock, the truncate, and the
 * unlock. `pg_advisory_xact_lock` is transaction-scoped: acquiring it
 * inside `$transaction` pins the whole critical section to one connection
 * for the transaction's lifetime, and the lock is released automatically
 * on commit/rollback — no separate unlock call needed, no possibility of
 * it landing on a different connection.
 *
 * Holds the lock for the ENTIRE duration of `callback` (not just the
 * truncate) — CR-04, 11-REVIEW.md: when multiple fully-parallel tests each
 * reset then separately create+read their own rows (e.g.
 * `db-isolation.spec.ts`), nothing would otherwise stop a *different*
 * test's reset from firing between this one's reset and its own
 * create/read, wiping this test's rows out from under it. Serializing the
 * whole reset+create+read cycle through one held transaction closes that
 * race.
 */
export async function withResetDbLock<T>(
  prisma: PrismaClient,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${RESET_DB_ADVISORY_LOCK_KEY})`);
      await tx.$executeRawUnsafe(
        'TRUNCATE "QrRemapHistory", "QrCode", "ClickEvent", "Link", "DomainMembership" RESTART IDENTITY CASCADE',
      );
      await reseedBaselineDomainMembership(tx);
      return callback(tx);
    },
    // Default interactive-transaction timeout (5s) is too tight once every
    // concurrent test's full create+read cycle is serialized through this
    // single critical section (CONCURRENT_TEST_COUNT tests, each queued
    // behind the previous one) — widen it well past the worst-case queue
    // depth so contention alone never trips Prisma's own transaction
    // timeout independent of the test's real logic.
    { timeout: 30_000 },
  );
}

/**
 * Re-applies the baseline Member's DomainMembership after
 * `withResetDbLock`'s truncate — `DomainMembership` is file-scoped/truncated
 * (specs may create their own memberships), but every spec still expects
 * the seeded Member to hold its baseline least-privilege membership unless
 * it deliberately mutates it. `User`/`Domain` rows are never truncated, so
 * they always exist by the time this runs.
 */
async function reseedBaselineDomainMembership(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  const domain = await prisma.domain.findUniqueOrThrow({
    where: { hostname: BASELINE_DOMAIN_HOSTNAME },
  });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: MEMBER_EMAIL } });

  await prisma.domainMembership.upsert({
    where: { userId_domainId: { userId: member.id, domainId: domain.id } },
    update: { role: "member" },
    create: { userId: member.id, domainId: domain.id, role: "member" },
  });
}
