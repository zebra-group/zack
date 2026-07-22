/**
 * Unit tests for `buildUtmPreview` (Phase 8, META-01, 08-UI-SPEC.md Surface A
 * Layout Contract) — the client-side mirror of the server's `applyUtmParams`
 * (apps/api/src/lib/redirectEngine.ts). Every case below has a hand-worked
 * expected string derived by walking `applyUtmParams`'s exact algorithm
 * (guard-first no-op, delete-then-set in canonical source/medium/campaign
 * order, WHATWG URL/URLSearchParams-only encoding) so the preview and the
 * eventual redirect can never disagree.
 */
import { describe, expect, it } from "vitest";
import { buildUtmPreview } from "./utm";

function utm(overrides: Partial<{ utmSource: string; utmMedium: string; utmCampaign: string }> = {}) {
  return { utmSource: "", utmMedium: "", utmCampaign: "", ...overrides };
}

describe("buildUtmPreview", () => {
  it("returns the locked fallback string when both the target and all three parameters are empty", () => {
    expect(buildUtmPreview("", utm())).toBe("https://example.com/…");
  });

  it("returns the typed target string UNCHANGED (no trailing slash added) when no parameter is set", () => {
    expect(buildUtmPreview("https://example.com", utm())).toBe("https://example.com");
  });

  it("introduces the first parameter with a question mark when the target has no existing query", () => {
    expect(buildUtmPreview("https://example.com/x", utm({ utmSource: "newsletter" }))).toBe(
      "https://example.com/x?utm_source=newsletter",
    );
  });

  it("introduces the first parameter with an ampersand when the target already has a query", () => {
    expect(buildUtmPreview("https://example.com/x?ref=abc", utm({ utmSource: "newsletter" }))).toBe(
      "https://example.com/x?ref=abc&utm_source=newsletter",
    );
  });

  it("renders only the non-empty parameters, in the fixed source/medium/campaign order, skipping source", () => {
    expect(
      buildUtmPreview("https://example.com/x", utm({ utmMedium: "email", utmCampaign: "launch" })),
    ).toBe("https://example.com/x?utm_medium=email&utm_campaign=launch");
  });

  it("still renders the three in canonical order when the target already defines utm_campaign (cross-check with applyUtmParams)", () => {
    // Hand-worked against apps/api/src/lib/redirectEngine.ts#applyUtmParams:
    // delete the three canonical keys first (removes the pre-existing
    // utm_campaign), THEN re-set source/medium/campaign in that order — a
    // bare `set` alone would have left utm_campaign pinned in its original
    // position instead of moving to the end.
    expect(
      buildUtmPreview(
        "https://example.com/x?utm_campaign=old",
        utm({ utmSource: "src", utmMedium: "med", utmCampaign: "camp" }),
      ),
    ).toBe("https://example.com/x?utm_source=src&utm_medium=med&utm_campaign=camp");
  });

  it("percent-encodes a value containing a space or an ampersand, matching URLSearchParams's encoding", () => {
    expect(buildUtmPreview("https://example.com/x", utm({ utmCampaign: "a b&c" }))).toBe(
      "https://example.com/x?utm_campaign=a+b%26c",
    );
  });

  it("overrides an existing utm_source on the target with the typed source (owner-wins rule)", () => {
    expect(buildUtmPreview("https://example.com/x?utm_source=old", utm({ utmSource: "new" }))).toBe(
      "https://example.com/x?utm_source=new",
    );
  });

  it("degrades to a readable fallback preview for a half-typed, unparseable target instead of throwing", () => {
    expect(buildUtmPreview("htt", utm({ utmSource: "src" }))).toBe("htt?utm_source=src");
    expect(buildUtmPreview("example", utm({ utmSource: "src" }))).toBe("example?utm_source=src");
  });

  it("uses an ampersand separator in the fallback path when the unparseable target already contains a question mark", () => {
    expect(buildUtmPreview("example?x=1", utm({ utmSource: "src" }))).toBe(
      "example?x=1&utm_source=src",
    );
  });

  it("never throws for a blank target with parameters set — falls back to the locked placeholder as the base", () => {
    expect(buildUtmPreview("", utm({ utmSource: "src" }))).toBe(
      "https://example.com/…?utm_source=src",
    );
  });
});
