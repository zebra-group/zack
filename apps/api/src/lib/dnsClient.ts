/**
 * DNS ownership verification (DOMAIN-02, D-02, D-03) — SSRF-safe by
 * construction: this module performs DNS resolution ONLY via
 * `node:dns/promises`. It must NEVER import or call an HTTP client against
 * a user-supplied domain (T-03-01) — the SSRF-canary test in
 * `test/dnsClient.test.ts` asserts the global `fetch` is never invoked
 * during a verify.
 *
 * `DnsResolver` is injected as a parameter (default `nodeDnsResolver`),
 * mirroring `routes/canary.ts`'s `canaryRoute(prisma)` /
 * `routes/auth.ts`'s `authRoute(auth)` factory-injection precedent — tests
 * stub DNS deterministically instead of `vi.mock`-ing a Node builtin (see
 * 03-PATTERNS.md / 03-RESEARCH.md Pattern 2).
 */
import * as dns from "node:dns/promises";

export type DnsResolver = {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
};

/** Default resolver, backed by Node's built-in `dns/promises` module. */
export const nodeDnsResolver: DnsResolver = {
  resolveCname: (hostname) => dns.resolveCname(hostname),
  resolve4: (hostname) => dns.resolve4(hostname),
};

/**
 * Verifies `hostname`'s DNS record against `expectedTarget` — CNAME lookup
 * for `"subdomain"`, A-record lookup for `"apex"` (D-02). Wraps the lookup
 * in a `Promise.race` against a `timeoutMs`-bounded timer (RESEARCH
 * Pitfall 5 — `dns/promises` has no native timeout/cancellation), so a
 * hung/unreachable nameserver can never leave the caller waiting
 * unbounded.
 *
 * NEVER throws past this function boundary: a mismatch is an expected
 * "not verified yet" outcome (`{ verified: false }`, no `error`); a
 * lookup failure (ENOTFOUND/ENODATA/DNS_TIMEOUT/anything else) is
 * surfaced as a structured `{ verified: false, error: "<code>" }` so the
 * caller (the verify route) can always safely persist a non-throwing
 * status transition (D-03).
 */
export async function verifyDomain(
  hostname: string,
  type: "subdomain" | "apex",
  expectedTarget: string,
  resolver: DnsResolver = nodeDnsResolver,
  timeoutMs = 5000,
): Promise<{ verified: boolean; error?: string }> {
  try {
    const records = await Promise.race([
      type === "subdomain" ? resolver.resolveCname(hostname) : resolver.resolve4(hostname),
      new Promise<string[]>((_resolve, reject) => {
        setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs);
      }),
    ]);

    // DNS records are FQDN-with-trailing-dot and can vary in case
    // (RESEARCH Anti-Patterns) — normalize both sides before comparing.
    const normalize = (value: string) => value.toLowerCase().replace(/\.$/, "");
    const normalizedRecords = records.map(normalize);
    const normalizedTarget = normalize(expectedTarget);

    return { verified: normalizedRecords.includes(normalizedTarget) };
  } catch (err) {
    const code =
      (err as NodeJS.ErrnoException).code ??
      (err instanceof Error ? err.message : "DNS_LOOKUP_FAILED");
    return { verified: false, error: code };
  }
}
