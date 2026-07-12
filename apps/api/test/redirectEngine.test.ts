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
 * Task 2 (botDetection/unlockCookie/rate-limit configs) tests are appended
 * below this section once Task 1 is GREEN.
 */
import { describe, expect, it } from "vitest";
import { mergeQuery, resolveLinkState } from "../src/lib/redirectEngine.js";

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
