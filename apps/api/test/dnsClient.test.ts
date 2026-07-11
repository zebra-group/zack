/**
 * dnsClient unit suite (DOMAIN-02, T-03-01 SSRF canary, Pitfall 5 timeout) —
 * covers verifyDomain's match/mismatch/timeout/normalize/error paths using
 * an INJECTED fake resolver (no real DNS, no vi.mock of a Node builtin —
 * mirrors canaryRoute(prisma)/authRoute(auth)'s factory-injection pattern,
 * per 03-PATTERNS.md).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DnsResolver } from "../src/lib/dnsClient.js";
import { verifyDomain } from "../src/lib/dnsClient.js";

/** Injectable fake resolver — never touches real DNS. */
function fakeDnsResolver(cnameRecords: string[], aRecords: string[]): DnsResolver {
  return {
    resolveCname: async () => cnameRecords,
    resolve4: async () => aRecords,
  };
}

describe("dnsClient.verifyDomain (DOMAIN-02, SSRF-safe by construction)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subdomain CNAME match → verified: true, no error", async () => {
    const resolver = fakeDnsResolver(["shortener.kurzly.local"], []);
    const result = await verifyDomain(
      "s.example.com",
      "subdomain",
      "shortener.kurzly.local",
      resolver,
    );
    expect(result).toEqual({ verified: true });
  });

  it("subdomain CNAME mismatch → verified: false, no error (expected outcome, not an error)", async () => {
    const resolver = fakeDnsResolver(["wrong.target.example"], []);
    const result = await verifyDomain(
      "s.example.com",
      "subdomain",
      "shortener.kurzly.local",
      resolver,
    );
    expect(result.verified).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("apex A-record match → verified: true", async () => {
    const resolver = fakeDnsResolver([], ["192.0.2.1"]);
    const result = await verifyDomain("example.com", "apex", "192.0.2.1", resolver);
    expect(result).toEqual({ verified: true });
  });

  it("normalizes trailing dot and case on both the record and the target", async () => {
    const resolver = fakeDnsResolver(["SHORTENER.KURZLY.LOCAL."], []);
    const result = await verifyDomain(
      "s.example.com",
      "subdomain",
      "shortener.kurzly.local",
      resolver,
    );
    expect(result.verified).toBe(true);
  });

  it("a resolver that never settles + a small timeoutMs → verified: false, error: DNS_TIMEOUT (never hangs)", async () => {
    const neverSettles: DnsResolver = {
      resolveCname: () => new Promise<string[]>(() => {}),
      resolve4: () => new Promise<string[]>(() => {}),
    };
    const result = await verifyDomain(
      "s.example.com",
      "subdomain",
      "shortener.kurzly.local",
      neverSettles,
      50,
    );
    expect(result).toEqual({ verified: false, error: "DNS_TIMEOUT" });
  });

  it("resolver throwing ENOTFOUND → verified: false, error: the error code (never throws)", async () => {
    const throwing: DnsResolver = {
      resolveCname: async () => {
        throw Object.assign(new Error("queryCname ENOTFOUND s.example.com"), {
          code: "ENOTFOUND",
        });
      },
      resolve4: async () => [],
    };
    const result = await verifyDomain(
      "s.example.com",
      "subdomain",
      "shortener.kurzly.local",
      throwing,
    );
    expect(result).toEqual({ verified: false, error: "ENOTFOUND" });
  });

  it("resolver throwing ENODATA → verified: false, error: the error code (never throws)", async () => {
    const throwing: DnsResolver = {
      resolveCname: async () => [],
      resolve4: async () => {
        throw Object.assign(new Error("queryA ENODATA example.com"), { code: "ENODATA" });
      },
    };
    const result = await verifyDomain("example.com", "apex", "192.0.2.1", throwing);
    expect(result).toEqual({ verified: false, error: "ENODATA" });
  });

  it("WR-03: clears the DNS-timeout timer once the resolver settles first (no dangling timer handle)", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    const resolver = fakeDnsResolver(["shortener.kurzly.local"], []);

    await verifyDomain("s.example.com", "subdomain", "shortener.kurzly.local", resolver, 5000);

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it("SSRF canary: verifyDomain never issues an HTTP fetch — global fetch spy recorded 0 calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const resolver = fakeDnsResolver(["shortener.kurzly.local"], []);
    await verifyDomain("s.example.com", "subdomain", "shortener.kurzly.local", resolver);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
