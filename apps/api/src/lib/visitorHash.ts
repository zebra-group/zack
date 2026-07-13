/**
 * Daily-rotating salted visitor hash (Phase 6, D-06/D-08, T-06-PII/T-06-XDAY).
 *
 * `computeVisitorHash` is a pure `node:crypto` HMAC-SHA256 transform — an
 * HMAC (not a bare hash) is required per RESEARCH's Don't-Hand-Roll table:
 * a bare unsalted hash of a small IP+UA space is trivially reversible via a
 * lookup table, HMAC with a secret, rotated, deletable salt is the standard
 * construction (matches Plausible's documented approach). Only the
 * resulting hex digest ever leaves this function — the raw ip/userAgent
 * are NEVER returned, logged, or persisted anywhere else.
 *
 * `resolveDailySalt` persists one random 32-byte salt per UTC day in the
 * `DailySalt` table (added 06-02) so the same visitor cannot be correlated
 * across days (D-06's "no cross-day tracking" property) while still
 * de-duplicating uniques WITHIN a single day. Takes `prisma` as a
 * parameter (injectable) so tests can bind it to the same
 * transaction-wrapped client the rest of the harness uses.
 *
 * No fetch/HTTP import in this module (privacy guarantee, T-06-PII) — the
 * only I/O here is the local Postgres DailySalt read/write.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * HMAC-SHA256(dailySalt, ip|userAgent|linkId) as a lowercase hex digest.
 * Deterministic for identical inputs; differs whenever the salt rotates
 * (the "rotation proof" — same ip+ua+linkId across two distinct salts
 * yields two distinct hashes), keeping cross-day re-identification
 * impossible even though same-day de-duplication still works.
 */
export function computeVisitorHash(
  salt: string,
  ip: string,
  userAgent: string,
  linkId: string,
): string {
  return createHmac("sha256", salt).update(`${ip}|${userAgent}|${linkId}`).digest("hex");
}

/**
 * Resolves (creating if absent) today's UTC daily salt. First call of a
 * UTC day creates one `DailySalt` row (random 32-byte hex value); every
 * subsequent call the same day returns the identical value. A simulated
 * concurrent create-race (two first-clicks of the day both attempting
 * `create`) is handled by re-reading the winner via `findUniqueOrThrow`
 * rather than throwing into the caller — tracking must never break the
 * redirect hot path (RESEARCH Pitfall 2's never-throw discipline, applied
 * here too).
 */
export async function resolveDailySalt(prisma: PrismaClient): Promise<string> {
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const existing = await prisma.dailySalt.findUnique({ where: { date: today } });
  if (existing) return existing.value;

  const value = randomBytes(32).toString("hex");
  try {
    const created = await prisma.dailySalt.create({ data: { date: today, value } });
    return created.value;
  } catch {
    const winner = await prisma.dailySalt.findUniqueOrThrow({ where: { date: today } });
    return winner.value;
  }
}
