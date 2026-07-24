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
import { PrismaClient } from "@kurzly/api/prisma-client";

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
 * Fixed integer key for `pg_advisory_lock`/`pg_advisory_unlock` around
 * `resetDb`'s truncate+reseed sequence (RESEARCH Pitfall 4) — arbitrary but
 * stable across the whole E2E suite so two parallel worker spec files can
 * never interleave their truncate/reseed against each other.
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
 * FK-safe truncate + reseed of the file-scoped mutable tables (RESEARCH
 * Pattern 3): `QrRemapHistory -> QrCode -> ClickEvent -> Link ->
 * DomainMembership`, `RESTART IDENTITY CASCADE`. Deliberately never
 * truncates `User`/`Domain`/`Session`/`Account`/`Verification` — truncating
 * `Session` mid-run would invalidate every spec project's saved
 * `storageState` (T-11-06). Uses the reused Prisma client's own
 * `$executeRawUnsafe` (no second `pg` driver dependency, per RESEARCH
 * "Don't Hand-Roll").
 *
 * Wrapped in a `pg_advisory_lock`/`pg_advisory_unlock` pair (RESEARCH
 * Pitfall 4) so two parallel worker spec files calling `resetDb()`
 * concurrently can never interleave their truncate+reseed against each
 * other — `fullyParallel` runs multiple spec FILES concurrently, and
 * without this lock one file's `TRUNCATE` could fire mid-write of another
 * file's `resetDb()` reseed.
 */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT pg_advisory_lock(${RESET_DB_ADVISORY_LOCK_KEY})`);
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "QrRemapHistory", "QrCode", "ClickEvent", "Link", "DomainMembership" RESTART IDENTITY CASCADE',
    );
    await reseedBaselineDomainMembership(prisma);
  } finally {
    await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(${RESET_DB_ADVISORY_LOCK_KEY})`);
  }
}

/**
 * Re-applies the baseline Member's DomainMembership after `resetDb`'s
 * truncate — `DomainMembership` is file-scoped/truncated (specs may create
 * their own memberships), but every spec still expects the seeded Member
 * to hold its baseline least-privilege membership unless it deliberately
 * mutates it. `User`/`Domain` rows are never truncated, so they always
 * exist by the time this runs.
 */
async function reseedBaselineDomainMembership(prisma: PrismaClient): Promise<void> {
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
