import { test, expect } from "@playwright/test";
import { buildImportCsv, IMPORT_CSV_HEADER } from "../../src/csv.js";

/**
 * RED->GREEN contract spec for `apps/e2e/src/csv.ts` (14-01-PLAN.md Task
 * 1/2) — the ONE shared CSV-fixture builder both CSV-import feature specs
 * (14-03/14-04) consume to construct runtime import CSVs with per-test
 * slugs. Centralising the exact `ziel_url,slug,domain` header here makes
 * 14-RESEARCH.md's Pitfall 4 (a header-mismatch 400 that masks all
 * per-row behaviour) structurally impossible in either CSV spec.
 *
 * Until `apps/e2e/src/csv.ts` exists, the import above fails to resolve
 * and every test in this file fails at module-load time — this is the
 * intended RED state (Task 1). Task 2 implements the module to turn this
 * GREEN, with zero application code touched under `apps/api/src` or
 * `apps/web/src`.
 */

test.describe("IMPORT_CSV_HEADER", () => {
  test("equals the literal ziel_url,slug,domain header", () => {
    expect(IMPORT_CSV_HEADER).toBe("ziel_url,slug,domain");
  });
});

test.describe("buildImportCsv", () => {
  test("renders the header first, then one line per row in order, with a trailing newline", () => {
    const csv = buildImportCsv([
      { zielUrl: "https://example.com/a", slug: "slug-a", domain: "e2e.kurzly.local" },
      { zielUrl: "https://example.com/b", slug: "slug-b", domain: "e2e.kurzly.local" },
    ]);

    const lines = csv.split("\n");
    expect(lines[0]).toBe(IMPORT_CSV_HEADER);
    expect(lines[1]).toBe("https://example.com/a,slug-a,e2e.kurzly.local");
    expect(lines[2]).toBe("https://example.com/b,slug-b,e2e.kurzly.local");
    // A trailing newline splits into a trailing empty element.
    expect(lines[lines.length - 1]).toBe("");
  });

  test("renders an omitted slug and omitted domain as empty trailing cells", () => {
    const csv = buildImportCsv([{ zielUrl: "https://example.com/bare" }]);

    const lines = csv.split("\n");
    expect(lines[1]).toBe("https://example.com/bare,,");
  });

  test("renders a provided slug and domain verbatim, in column order", () => {
    const csv = buildImportCsv([
      { zielUrl: "https://example.com/full", slug: "my-slug", domain: "e2e.kurzly.local" },
    ]);

    const lines = csv.split("\n");
    expect(lines[1]).toBe("https://example.com/full,my-slug,e2e.kurzly.local");
  });

  test("emits only the header line (plus trailing newline) for a zero-row input", () => {
    const csv = buildImportCsv([]);

    expect(csv).toBe(`${IMPORT_CSV_HEADER}\n`);
  });

  test("the header line is present exactly once and always first, regardless of row count", () => {
    const csv = buildImportCsv([
      { zielUrl: "https://example.com/one" },
      { zielUrl: "https://example.com/two" },
      { zielUrl: "https://example.com/three" },
    ]);

    const lines = csv.split("\n").filter((line) => line.length > 0);
    expect(lines[0]).toBe(IMPORT_CSV_HEADER);
    expect(lines.filter((line) => line === IMPORT_CSV_HEADER)).toHaveLength(1);
    expect(lines).toHaveLength(4); // header + 3 rows
  });
});
