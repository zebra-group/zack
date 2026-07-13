/**
 * Referrer host normalization (Phase 6, D-07).
 *
 * `normalizeReferrer` extracts ONLY the source host from a `Referer`
 * header, discarding path/query — mirrors `lib/hostname.ts`'s established
 * "use the WHATWG `URL` parser, not a hand-rolled regex" convention
 * (URLs have userinfo/IPv6-literal/punycode edge cases regex would miss).
 *
 * The `Referer` header is untrusted input (any client can send an
 * arbitrary string) — this function NEVER throws; malformed/missing input
 * maps to `null`. Store `null`, not the German "Direkt" label, here — that
 * translation happens at the DTO/view boundary so raw storage stays
 * locale-neutral (RESEARCH Anti-Pattern).
 *
 * No fetch/HTTP import in this module (privacy guarantee, T-06-3P) — this
 * is a purely local string transform.
 */
export function normalizeReferrer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).hostname || null;
  } catch {
    return null;
  }
}
