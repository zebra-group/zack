/**
 * Retention pruning (Phase 6, D-12) — two independent, directly-testable
 * batch functions, not a scheduler. `server.ts` wires a simple daily
 * `setInterval` (plus one run at boot) around these; the functions
 * themselves are what the test suite exercises against real Postgres
 * (RESEARCH's Validation Architecture note: test the pruning FUNCTION, not
 * the timer). Reads `process.env` directly at call time (not `loadEnv()`),
 * mirroring `lib/geoip.ts`'s `resolveDbPath`/`routes/redirect.ts`'s
 * `brandCtx` convention, so this module works under Vitest without a
 * boot-time ENV parse.
 */
import type { PrismaClient } from "../generated/prisma/client.js";

const DAILY_SALT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000; // ~2 UTC days (Open Question 2)

function resolveRetentionDays(): number | null {
  const raw = process.env.CLICK_RETENTION_DAYS;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Deletes raw `ClickEvent` rows older than `CLICK_RETENTION_DAYS`. Absence
 * or an invalid value means "never prune" (returns 0, a no-op) — a fresh
 * instance must boot with zero tracking config, never a silently-applied
 * window. Never touches `Link.lifetimeClicks` (D-13): the all-time counter
 * is intentionally not derived from the event rows at read time, so it
 * survives pruning untouched.
 */
export async function pruneClickEvents(prisma: PrismaClient): Promise<number> {
  const retentionDays = resolveRetentionDays();
  if (retentionDays === null) return 0;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.clickEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Unconditionally deletes `DailySalt` rows older than ~2 UTC days — a
 * privacy property independent of `CLICK_RETENTION_DAYS` (RESEARCH Open
 * Question 2), keeping cross-day visitor re-identification impossible even
 * when raw events are retained for the full click-retention window. Keeps
 * today + yesterday so any in-flight same-day hashing never loses its salt
 * mid-request.
 */
export async function pruneDailySalts(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - DAILY_SALT_RETENTION_MS).toISOString().slice(0, 10);
  const result = await prisma.dailySalt.deleteMany({
    where: { date: { lt: cutoff } },
  });
  return result.count;
}
