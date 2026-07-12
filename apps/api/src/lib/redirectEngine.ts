/**
 * Redirect-precedence + query-forward engine (D-12/D-13/D-14, REDIR-03/04/05,
 * RESEARCH Pattern 2 + Pattern 5) — two PURE, side-effect-free functions the
 * redirect route (05-06) composes. Zero Fastify/HTTP awareness, zero
 * database access — `resolveLinkState` classifies an ALREADY-FETCHED Link's
 * scalar fields; `mergeQuery` transforms two already-validated strings. Both
 * are unit-tested directly with object-literal fixtures (see
 * `test/redirectEngine.test.ts`) — RESEARCH's rationale for keeping this
 * logic as pure functions is that it keeps the security-critical precedence
 * ordering and the target-wins merge testable without `fastify.inject`/an
 * HTTP server, mirroring `lib/domainResolution.ts`'s deny-by-default,
 * safest-branch-first discipline.
 *
 * PRECEDENCE (D-14, T-05-PRECEDENCE): expiry is checked FIRST and
 * UNCONDITIONALLY — an expired+password-protected link is ALWAYS "expired",
 * never "protected". This ordering is the single highest-value security
 * check in this file; do not reorder the two `if` branches below.
 *
 * QUERY MERGE (D-12/D-13, T-05-OPENREDIR): `mergeQuery` can only ever APPEND
 * query-string keys the target doesn't already define — it never touches
 * `target`'s scheme/host/path, so it introduces no open-redirect surface.
 * The target URL was already validated http(s)-only at write time by
 * `lib/links.ts`'s `validateTargetUrl`. Encoding is delegated entirely to
 * WHATWG `URL`/`URLSearchParams` (RESEARCH "Don't Hand-Roll" — no manual
 * `&`/`=` splitting).
 */
import type { Link } from "../generated/prisma/client.js";

export type LinkState = "expired" | "protected" | "ok";

/**
 * The subset of `Link` `resolveLinkState` needs — deliberately NOT the full
 * Prisma model, so any already-fetched Link-shaped object (a real row, a
 * test fixture, or a future DTO) can be classified without extra plumbing.
 */
export type LinkStateInput = Pick<Link, "passwordHash" | "expiresAt">;

/**
 * Classifies a link's redirect-time state. Order matters (D-14): expiry is
 * evaluated first and unconditionally, before the password check — an
 * expired link is ALWAYS "expired", even if it is also password-protected
 * and/or the caller already holds a valid unlock cookie for it.
 */
export function resolveLinkState(
  link: LinkStateInput,
  hasValidUnlockCookie: boolean,
): LinkState {
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return "expired";
  if (link.passwordHash && !hasValidUnlockCookie) return "protected";
  return "ok";
}

/**
 * Merges `incomingSearch` (a raw `?a=b&c=d`-shaped query string, or `""`)
 * onto `targetUrl`'s existing search params — the TARGET wins on key
 * conflict (D-13): only keys the target does not already define are
 * appended. `targetUrl`'s scheme/host/path are never touched.
 */
export function mergeQuery(targetUrl: string, incomingSearch: string): string {
  const target = new URL(targetUrl);
  const incoming = new URLSearchParams(incomingSearch);
  for (const [key, value] of incoming) {
    if (!target.searchParams.has(key)) {
      target.searchParams.append(key, value);
    }
  }
  return target.toString();
}
