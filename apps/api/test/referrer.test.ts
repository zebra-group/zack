/**
 * Referrer normalization unit suite (Phase 6, 06-03-PLAN.md Task 1, D-07).
 *
 * `normalizeReferrer` is a pure Node-builtin transform (WHATWG `URL`, no
 * regex — mirrors `lib/hostname.ts`'s own "use the URL parser, not a
 * hand-rolled regex" convention) with ZERO database/network access, so this
 * file uses plain string fixtures and direct calls, matching
 * `test/redirectEngine.test.ts`'s pure-function unit-test shape (no
 * `setupFileEach` harness needed).
 *
 * Covers:
 * - host-only extraction (path/query discarded) for a well-formed Referer
 * - null for missing (undefined), empty, and malformed input — the
 *   "Referer is untrusted input, never throw" contract (RESEARCH Pattern 4)
 */
import { describe, expect, it } from "vitest";
import { normalizeReferrer } from "../src/lib/referrer.js";

describe("normalizeReferrer (D-07, host-only, never throws)", () => {
  it("extracts only the source host from a well-formed Referer, discarding path/query", () => {
    expect(normalizeReferrer("https://t.co/abc?x=1")).toBe("t.co");
  });

  it("extracts the host from a Referer with no path/query", () => {
    expect(normalizeReferrer("https://google.com")).toBe("google.com");
  });

  it("returns null for an empty string", () => {
    expect(normalizeReferrer("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizeReferrer(undefined)).toBeNull();
  });

  it("returns null for a malformed, non-URL string (never throws)", () => {
    expect(() => normalizeReferrer("not a url")).not.toThrow();
    expect(normalizeReferrer("not a url")).toBeNull();
  });

  it("never returns the raw referrer string itself — only the bare hostname", () => {
    const result = normalizeReferrer("https://t.co/abc?x=1");
    expect(result).not.toContain("/abc");
    expect(result).not.toContain("x=1");
    expect(result).not.toContain("https://");
  });
});
