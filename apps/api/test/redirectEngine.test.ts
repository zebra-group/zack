/**
 * Pure-function unit suite for the redirect engine's building blocks
 * (Phase 5, 05-04-PLAN.md) — every function under test here has ZERO
 * Fastify/HTTP awareness and ZERO database access, so this file uses plain
 * object-literal fixtures and direct calls, mirroring
 * `test/domainResolution.test.ts`'s pure-function unit-test shape but
 * WITHOUT that file's real-Postgres `setupFileEach` harness (no DB is
 * touched by anything under test here).
 *
 * Covers (Task 1):
 * 1. `resolveLinkState` (D-14, REDIR-03/04/05) — the precedence classifier:
 *    expiry is checked FIRST and UNCONDITIONALLY, even when a password is
 *    also set (T-05-PRECEDENCE).
 * 2. `mergeQuery` (D-12/D-13) — query-forward merge: the stored TARGET wins
 *    on key conflict; no open-redirect surface (T-05-OPENREDIR).
 *
 * Covers (Task 2):
 * 3. `isBotRequest` (D-04) — thin `isbot` wrapper.
 * 4. `unlockPayload`/`cookieName` (D-07/D-08) — the self-invalidating
 *    unlock-cookie payload/name primitives (T-05-COOKIE-FORGE). The signed
 *    issue/verify cookie round-trip itself (`issueUnlockCookie`/
 *    `hasValidUnlockCookie`) needs a real Fastify reply/request with
 *    `@fastify/cookie` registered — proven end-to-end in 05-06's route
 *    integration test, not here.
 * 5. `VERIFY_RATE_LIMIT_PER_LINK`'s `keyGenerator` (D-15, RESEARCH
 *    Pitfall 4) — per-(IP, host, slug) key shape, proven with a stub
 *    request-like object (no real FastifyRequest needed — the function is
 *    deliberately Fastify-free, see rateLimit.ts).
 */
import { describe, expect, it } from "vitest";
import { isBotRequest } from "../src/lib/botDetection.js";
import {
  applyUtmParams,
  mergeQuery,
  resolveLinkState,
  type LinkUtmParams,
} from "../src/lib/redirectEngine.js";
import { cookieName, unlockPayload } from "../src/lib/unlockCookie.js";
import { REDIRECT_RATE_LIMIT, VERIFY_RATE_LIMIT_PER_LINK } from "../src/plugins/rateLimit.js";

const NO_UTM: LinkUtmParams = { utmSource: null, utmMedium: null, utmCampaign: null };

const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("resolveLinkState (D-14, precedence: expired > protected > ok)", () => {
  it("returns 'expired' when expiresAt is in the past, EVEN IF passwordHash is also set (expiry wins)", () => {
    const state = resolveLinkState(
      {
        passwordHash: "bcrypt-hash-stub",
        expiresAt: new Date(Date.now() - 60_000),
      },
      false,
    );
    expect(state).toBe("expired");
  });

  it("returns 'expired' for an expired+protected link even with a VALID unlock cookie (expiry checked first, unconditionally)", () => {
    const state = resolveLinkState(
      {
        passwordHash: "bcrypt-hash-stub",
        expiresAt: new Date(Date.now() - 60_000),
      },
      true,
    );
    expect(state).toBe("expired");
  });

  it("returns 'protected' when passwordHash is set, not expired, and no valid unlock cookie", () => {
    const state = resolveLinkState(
      { passwordHash: "bcrypt-hash-stub", expiresAt: null },
      false,
    );
    expect(state).toBe("protected");
  });

  it("returns 'protected' when passwordHash is set, not expired (future expiresAt), and no valid unlock cookie", () => {
    const state = resolveLinkState(
      {
        passwordHash: "bcrypt-hash-stub",
        expiresAt: new Date(Date.now() + 60_000),
      },
      false,
    );
    expect(state).toBe("protected");
  });

  it("returns 'ok' when passwordHash is set and hasValidUnlockCookie is true", () => {
    const state = resolveLinkState(
      { passwordHash: "bcrypt-hash-stub", expiresAt: null },
      true,
    );
    expect(state).toBe("ok");
  });

  it("returns 'ok' when passwordHash is null and not expired", () => {
    const state = resolveLinkState({ passwordHash: null, expiresAt: null }, false);
    expect(state).toBe("ok");
  });

  it("never returns 'expired' when expiresAt is null (no expiry set)", () => {
    const state = resolveLinkState(
      { passwordHash: null, expiresAt: null },
      false,
    );
    expect(state).not.toBe("expired");
  });

  it("boundary: expiresAt exactly equal to 'now' is treated as expired (<=, inclusive)", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const realDateNow = Date.now;
    Date.now = () => now.getTime();
    try {
      const state = resolveLinkState(
        { passwordHash: null, expiresAt: new Date(now.getTime()) },
        false,
      );
      expect(state).toBe("expired");
    } finally {
      Date.now = realDateNow;
    }
  });

  it("boundary: expiresAt one millisecond in the future is NOT expired", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const realDateNow = Date.now;
    Date.now = () => now.getTime();
    try {
      const state = resolveLinkState(
        { passwordHash: null, expiresAt: new Date(now.getTime() + 1) },
        false,
      );
      expect(state).not.toBe("expired");
    } finally {
      Date.now = realDateNow;
    }
  });
});

describe("mergeQuery (D-12/D-13, target wins on conflict, no open-redirect surface)", () => {
  it("appends only keys the target does not already define; target's own value wins on conflict", () => {
    const merged = mergeQuery(
      "https://x.com/p?utm_source=a",
      "?utm_source=b&ref=c",
    );
    expect(merged).toBe("https://x.com/p?utm_source=a&ref=c");
  });

  it("returns the target unchanged when incomingSearch is empty", () => {
    const merged = mergeQuery("https://x.com/p?utm_source=a", "");
    expect(merged).toBe("https://x.com/p?utm_source=a");
  });

  it("returns the target unchanged when incomingSearch has no keys the target lacks", () => {
    const merged = mergeQuery("https://x.com/p?a=1&b=2", "?a=9&b=9");
    expect(merged).toBe("https://x.com/p?a=1&b=2");
  });

  it("preserves the semantic value of an appended percent-encoded incoming param", () => {
    const merged = mergeQuery(
      "https://x.com/p",
      `?msg=${encodeURIComponent("hello world & more")}`,
    );
    expect(new URL(merged).searchParams.get("msg")).toBe("hello world & more");
  });

  it("never changes the target's scheme, host, or path — only appends query keys", () => {
    const target = "https://x.example.com/some/path";
    const merged = mergeQuery(target, "?evil=https://attacker.example/&a=1");
    const parsed = new URL(merged);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.host).toBe("x.example.com");
    expect(parsed.pathname).toBe("/some/path");
  });
});

describe("applyUtmParams (D-08-02, owner-wins UTM application)", () => {
  it("appends a single set parameter to a target with no existing query", () => {
    const result = applyUtmParams("https://example.com/p", {
      utmSource: "newsletter",
      utmMedium: null,
      utmCampaign: null,
    });
    expect(result).toBe("https://example.com/p?utm_source=newsletter");
  });

  it("adds the parameter alongside an existing query string (delegated to URL, not hand-assembled)", () => {
    const result = applyUtmParams("https://example.com/p?a=1", {
      utmSource: "x",
      utmMedium: null,
      utmCampaign: null,
    });
    const parsed = new URL(result);
    expect(parsed.searchParams.get("a")).toBe("1");
    expect(parsed.searchParams.get("utm_source")).toBe("x");
  });

  it("overrides a same-named utm_source already present on the target (opposite of mergeQuery's target-wins rule)", () => {
    const result = applyUtmParams("https://example.com/p?utm_source=visitor-set", {
      utmSource: "owner-set",
      utmMedium: null,
      utmCampaign: null,
    });
    expect(new URL(result).searchParams.get("utm_source")).toBe("owner-set");
  });

  it("still renders source, medium, campaign in canonical order even when the target already defines utm_campaign earlier", () => {
    const result = applyUtmParams("https://example.com/p?utm_campaign=pinned&z=1", {
      utmSource: "src",
      utmMedium: "med",
      utmCampaign: "camp",
    });
    const search = new URL(result).search;
    const sourceIdx = search.indexOf("utm_source");
    const mediumIdx = search.indexOf("utm_medium");
    const campaignIdx = search.indexOf("utm_campaign");
    expect(sourceIdx).toBeGreaterThan(-1);
    expect(mediumIdx).toBeGreaterThan(sourceIdx);
    expect(campaignIdx).toBeGreaterThan(mediumIdx);
  });

  it("percent-encodes values via URLSearchParams; re-parsing yields the original value back", () => {
    const result = applyUtmParams("https://example.com/p", {
      utmSource: null,
      utmMedium: null,
      utmCampaign: "sommer & sonne",
    });
    expect(result).toContain("utm_campaign=");
    expect(result).not.toContain("sommer & sonne");
    expect(new URL(result).searchParams.get("utm_campaign")).toBe("sommer & sonne");
  });

  it("returns the target unchanged, byte-for-byte identical to the input string, when all three are null", () => {
    const result = applyUtmParams("https://example.com", NO_UTM);
    expect(result).toBe("https://example.com");
  });

  it("returns the target unchanged when all three are empty or whitespace-only strings", () => {
    const result = applyUtmParams("https://example.com/p?a=1#frag", {
      utmSource: "",
      utmMedium: "   ",
      utmCampaign: "",
    });
    expect(result).toBe("https://example.com/p?a=1#frag");
  });

  it("does not URL-round-trip a no-UTM target — no added trailing slash on an origin-only URL", () => {
    const result = applyUtmParams("https://example.com", NO_UTM);
    expect(result).not.toBe("https://example.com/");
    expect(result).toBe("https://example.com");
  });

  it("only applies non-empty values — a whitespace-only utmMedium is treated as not set", () => {
    const result = applyUtmParams("https://example.com/p", {
      utmSource: "src",
      utmMedium: "   ",
      utmCampaign: null,
    });
    const parsed = new URL(result);
    expect(parsed.searchParams.has("utm_medium")).toBe(false);
    expect(parsed.searchParams.get("utm_source")).toBe("src");
  });

  it("preserves a target's manually-embedded utm_campaign when the builder only sets utm_source (WR-01)", () => {
    const result = applyUtmParams("https://shop.com/?utm_campaign=fall", {
      utmSource: "newsletter",
      utmMedium: null,
      utmCampaign: null,
    });
    const parsed = new URL(result);
    // utm_source is applied...
    expect(parsed.searchParams.get("utm_source")).toBe("newsletter");
    // ...but the owner's manually-typed utm_campaign is NOT erased, because
    // the builder's utm_campaign field was left empty (only present keys are
    // delete-then-set).
    expect(parsed.searchParams.get("utm_campaign")).toBe("fall");
  });

  it("leaves an embedded utm_medium untouched when the builder sets only utm_campaign (WR-01)", () => {
    const result = applyUtmParams("https://shop.com/?utm_medium=cpc", {
      utmSource: null,
      utmMedium: null,
      utmCampaign: "spring",
    });
    const parsed = new URL(result);
    expect(parsed.searchParams.get("utm_medium")).toBe("cpc");
    expect(parsed.searchParams.get("utm_campaign")).toBe("spring");
  });

  it("never alters the target's scheme, host, or path", () => {
    const result = applyUtmParams("https://x.example.com/some/path", {
      utmSource: "src",
      utmMedium: null,
      utmCampaign: null,
    });
    const parsed = new URL(result);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.host).toBe("x.example.com");
    expect(parsed.pathname).toBe("/some/path");
  });

  it("composes with mergeQuery in the D-08-02 order: the owner's utm_source survives a visitor-forwarded utm_source", () => {
    const target = "https://example.com/p";
    const utm: LinkUtmParams = { utmSource: "owner", utmMedium: null, utmCampaign: null };
    const composed = mergeQuery(applyUtmParams(target, utm), "?utm_source=visitor");
    expect(new URL(composed).searchParams.get("utm_source")).toBe("owner");
  });
});

describe("isBotRequest (D-04, thin isbot wrapper)", () => {
  it("returns true for a known crawler UA (Googlebot)", () => {
    expect(isBotRequest(GOOGLEBOT_UA)).toBe(true);
  });

  it("returns false for a real desktop browser UA (Chrome)", () => {
    expect(isBotRequest(CHROME_UA)).toBe(false);
  });

  it("returns false for a missing (undefined) User-Agent", () => {
    expect(isBotRequest(undefined)).toBe(false);
  });
});

describe("unlockPayload / cookieName (D-07/D-08, self-invalidating unlock cookie)", () => {
  it("cookieName produces a stable 'zack_unlock_<linkId>' string", () => {
    expect(cookieName("link_abc123")).toBe("zack_unlock_link_abc123");
  });

  it("unlockPayload is deterministic — the same hash always produces the same payload", () => {
    const hashA = "$2b$11$stubhashvalueAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(unlockPayload(hashA)).toBe(unlockPayload(hashA));
  });

  it("unlockPayload changes when the underlying passwordHash changes (self-invalidation on password rotation/removal)", () => {
    const hashA = "$2b$11$stubhashvalueAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const hashB = "$2b$11$stubhashvalueBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    expect(unlockPayload(hashA)).not.toBe(unlockPayload(hashB));
  });
});

describe("VERIFY_RATE_LIMIT_PER_LINK.keyGenerator (D-15, RESEARCH Pitfall 4)", () => {
  it("keys on ip:hostname:slug so two domains sharing a slug get separate rate-limit buckets", () => {
    const keyA = VERIFY_RATE_LIMIT_PER_LINK.keyGenerator({
      ip: "203.0.113.5",
      hostname: "domain-a.example.com",
      params: { slug: "promo" },
    });
    const keyB = VERIFY_RATE_LIMIT_PER_LINK.keyGenerator({
      ip: "203.0.113.5",
      hostname: "domain-b.example.com",
      params: { slug: "promo" },
    });
    expect(keyA).toBe("203.0.113.5:domain-a.example.com:promo");
    expect(keyB).toBe("203.0.113.5:domain-b.example.com:promo");
    expect(keyA).not.toBe(keyB);
  });

  it("produces distinct keys for two different IPs against the same host+slug", () => {
    const keyA = VERIFY_RATE_LIMIT_PER_LINK.keyGenerator({
      ip: "203.0.113.5",
      hostname: "domain-a.example.com",
      params: { slug: "promo" },
    });
    const keyB = VERIFY_RATE_LIMIT_PER_LINK.keyGenerator({
      ip: "198.51.100.9",
      hostname: "domain-a.example.com",
      params: { slug: "promo" },
    });
    expect(keyA).not.toBe(keyB);
  });
});

describe("Rate-limit consts exist with the expected shape (D-15/D-16)", () => {
  it("REDIRECT_RATE_LIMIT is a generous limit (higher max than the tight per-link verify limit)", () => {
    expect(REDIRECT_RATE_LIMIT.max).toBeGreaterThan(VERIFY_RATE_LIMIT_PER_LINK.max);
    expect(typeof REDIRECT_RATE_LIMIT.timeWindow).toBe("string");
  });

  it("VERIFY_RATE_LIMIT_PER_LINK is a tight limit", () => {
    expect(VERIFY_RATE_LIMIT_PER_LINK.max).toBeLessThanOrEqual(10);
    expect(typeof VERIFY_RATE_LIMIT_PER_LINK.timeWindow).toBe("string");
  });
});
