/**
 * Unit test for the shared `formatDate()` helper (IN-03 fix, 04-REVIEW.md)
 * — extracted from a formerly duplicated implementation in LinksView.vue
 * and LinkDetailView.vue.
 */
import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("formats an ISO 8601 date string as dd.mm.yyyy", () => {
    // Midday UTC — avoids day-rollover flakiness from `formatDate`'s use of
    // local-time getters (`getDate`/`getMonth`) across CI timezones.
    expect(formatDate("2026-07-11T12:00:00.000Z")).toBe("11.07.2026");
  });

  it("pads single-digit day and month with a leading zero", () => {
    expect(formatDate("2026-01-05T12:00:00.000Z")).toBe("05.01.2026");
  });
});
