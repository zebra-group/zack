/**
 * Host-header resolution guard (D-01 reformulated DOMAIN-03, Pattern 4,
 * T-03-02) — mirrors `apps/api/src/lib/authorization.ts`'s deny-by-default
 * contract: absence of an exact-match, ACTIVE-status `Domain` row is always
 * treated as denial, never as a wildcard/substring/first-domain fallback.
 *
 * This is the SINGLE host-resolution path both the `GET /api/tls-check` ask
 * endpoint (this plan) and the Phase 5 redirect engine depend on — the
 * signature is FROZEN, keep it stable for that downstream reuse.
 *
 * CRITICAL: never derive a domain-resolution decision from a raw
 * `request.hostname` or `X-Forwarded-Host` header without going through this
 * exact-match lookup (Pitfall 1, Fastify CVE-2026-3635 context).
 */
import type { Domain, PrismaClient } from "../generated/prisma/client.js";
import { normalizeHostname } from "./hostname.js";

export async function resolveActiveDomainByHost(
  prisma: PrismaClient,
  rawHost: string | undefined,
): Promise<Domain | null> {
  if (!rawHost) return null;

  // Strip a trailing :port BEFORE normalizing (CR-01) — normalizeHostname
  // is the SAME function `POST /api/domains` uses to canonicalize what it
  // persists, so a stored hostname and an incoming Host/SNI always compare
  // in identical form regardless of casing or a trailing dot.
  const withoutPort = rawHost.split(":")[0] ?? "";
  const normalized = normalizeHostname(withoutPort);
  if (!normalized) return null;

  const domain = await prisma.domain.findUnique({ where: { hostname: normalized } });
  if (!domain || domain.status !== "active") return null;

  return domain;
}
