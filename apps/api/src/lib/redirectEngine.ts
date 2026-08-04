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
 *
 * UTM APPLICATION (D-08-02, META-01): `applyUtmParams` is `mergeQuery`'s
 * mirror image, not a variant of it — same `URL`/`URLSearchParams`-only
 * mutation discipline (scheme/host/path never touched), but the OPPOSITE
 * conflict resolution. The composition order the route layer must use when
 * building a redirect target is:
 *   1. start from `targetUrl`
 *   2. apply the link's UTM parameters via `applyUtmParams`, OVERRIDING any
 *      same-named keys already on the target
 *   3. only when `forwardQuery` is on, merge the visitor's incoming query
 *      onto the result of step 2 via `mergeQuery`, whose target-wins rule
 *      is unchanged — the result of step 2 is "the target" for that merge
 * The two functions resolve conflicts in opposite directions on purpose:
 * the visitor must never be able to rewrite the destination (`mergeQuery`,
 * D-13), whereas the owner typed the UTM parameters into this link's own
 * builder and their intent is authoritative over whatever the stored
 * target happens to already carry (`applyUtmParams`, D-08-02).
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
 * Query parameter a STATIC QR code's encoded short URL carries so its scans
 * can be attributed back to the originating `QrCode` row (QR-07). A dynamic
 * code needs no such marker — it owns the `/q/:code` route and is identified
 * by the path itself — but a static code encodes the link's plain short URL
 * and would otherwise be indistinguishable from any other visit.
 *
 * Zack-internal: `routes/redirect.ts` strips it before merging the incoming
 * query onto the destination, so it never reaches the target.
 */
export const QR_SCAN_PARAM = "qr";

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

/**
 * Standalone structural type — deliberately NOT `Pick<Link, ...>`. This
 * plan runs in the same wave as the migration that adds `utmSource`/
 * `utmMedium`/`utmCampaign` to the generated Prisma `Link` type, and a
 * structural declaration keeps this module genuinely dependency-free, as
 * this file's header promises (zero Fastify/HTTP/Prisma-runtime awareness).
 * A fetched Prisma `Link` row structurally satisfies this type, so the
 * route layer can pass the row straight through without any mapping step.
 */
export type LinkUtmParams = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

/**
 * Applies the link owner's UTM parameters to a target URL (D-08-02,
 * META-01) — the opposite conflict rule from `mergeQuery` (see the module
 * header's composition order): a same-named key already on the target is
 * OVERRIDDEN, because the owner typed these values into this link's own
 * builder, not forwarded from an untrusted visitor.
 *
 * The guard below is load-bearing, not an optimisation: when none of the
 * three values is set, `targetUrl` is returned UNCHANGED as the raw input
 * string, with no `new URL()` round-trip. `new URL(x).toString()` silently
 * normalises its input (e.g. it appends a trailing slash to an origin-only
 * URL, and can rewrite encoding/fragments), which would make every
 * no-UTM redirect differ from the exact target string `lib/links.ts`
 * stored — breaking the Phase 5 guarantee that a plain link redirects to
 * exactly what was saved.
 *
 * When at least one value is set, only `searchParams` is mutated —
 * scheme/host/path are never touched, the same structural no-open-redirect
 * guarantee `mergeQuery` already carries (T-08-OPENREDIR-UTM). Only the
 * canonical keys the builder actually SETS are delete-then-set, each in the
 * locked `source, medium, campaign` order (WR-01): the delete-before-set of
 * a present key strips any pre-existing occurrence so the key re-appends at
 * the end in canonical order rather than staying pinned in its original
 * position. A key whose builder field is EMPTY is left untouched, so a
 * value the owner manually embedded in `targetUrl` (e.g. `utm_campaign=fall`
 * with only `utm_source` filled in the builder) is preserved instead of
 * being silently erased. `URLSearchParams` performs the percent-encoding
 * (D-08-05) — no hand-rolled `&`/`=` assembly.
 */
export function applyUtmParams(targetUrl: string, utm: LinkUtmParams): string {
  const hasAny =
    isSetUtmValue(utm.utmSource) || isSetUtmValue(utm.utmMedium) || isSetUtmValue(utm.utmCampaign);
  if (!hasAny) return targetUrl;

  const target = new URL(targetUrl);
  if (isSetUtmValue(utm.utmSource)) {
    target.searchParams.delete("utm_source");
    target.searchParams.set("utm_source", utm.utmSource as string);
  }
  if (isSetUtmValue(utm.utmMedium)) {
    target.searchParams.delete("utm_medium");
    target.searchParams.set("utm_medium", utm.utmMedium as string);
  }
  if (isSetUtmValue(utm.utmCampaign)) {
    target.searchParams.delete("utm_campaign");
    target.searchParams.set("utm_campaign", utm.utmCampaign as string);
  }
  return target.toString();
}

/** A UTM value counts as "set" only when it is a non-empty, non-whitespace-only string. */
function isSetUtmValue(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
