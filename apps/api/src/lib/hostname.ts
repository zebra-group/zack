/**
 * Shared hostname normalization (CR-01).
 *
 * `normalizeHostname()` is the SINGLE canonical-form function both
 * `POST /api/domains` (routes/domains.ts's `createDomainSchema`, applied
 * before the uniqueness pre-check AND before persistence) and
 * `resolveActiveDomainByHost` (lib/domainResolution.ts, applied to the
 * incoming Host/SNI before its exact-match lookup) must use. Before this
 * fix, the create path never normalized at all while the read path always
 * lowercased — that asymmetry let a case/trailing-dot variant of an
 * already-verified hostname be registered by an unrelated user (DNS
 * resolution is case-insensitive and trailing-dot-tolerant per RFC 1035,
 * so the variant would pass DNS ownership "proof" too) AND let a
 * legitimately-created non-lowercase hostname become permanently
 * unreachable via the read-side guard. Routing both sides through this one
 * function means they can never drift apart again.
 */
export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Hostname shape validation (WR-02) — labels of 1-63 alphanumeric-or-hyphen
 * chars (no leading/trailing hyphen per label), at least one dot, TLD of
 * 2-63 letters. Applied to the ALREADY-NORMALIZED value (lowercase, no
 * trailing dot) coming out of `normalizeHostname()`. Deliberately rejects
 * whitespace-only/symbol-only/overlong inputs that would otherwise sit in
 * the DB forever as a perpetually-failing-verification row.
 */
export const HOSTNAME_FORMAT_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Total hostname length ceiling per RFC 1035 (253 octets, dot-inclusive). */
export const HOSTNAME_MAX_LENGTH = 253;
