/**
 * E2E CSV-fixture builder for the Links bulk-import flow (14-01-PLAN.md,
 * LINKS-E2E-02/03).
 *
 * `POST /api/links/import/preview` and `.../commit` validate the CSV header
 * via a `Set` membership check against the exact key names
 * `EXPECTED_CSV_COLUMNS = ["ziel_url", "slug", "domain"]`
 * (`apps/api/src/lib/links.ts`, 14-RESEARCH.md Pitfall 4) -- any renamed or
 * misspelled column 400s the WHOLE import before a single row is evaluated,
 * masking real per-row behaviour. Centralising the header line here, as the
 * one place every CSV-import fixture is built, makes that failure mode
 * structurally impossible for 14-03 (happy path) and 14-04 (slug conflict):
 * neither spec hand-concatenates the header string itself, so neither can
 * typo it.
 *
 * `buildImportCsv` also lets 14-04 embed a slug computed at runtime (e.g. one
 * just created via `apps/e2e/src/links.ts`'s `createE2eLink`) into a CSV row
 * without manual string concatenation.
 *
 * Deliberately dependency-free: this is a plain string join, not a CSV
 * parser/writer library -- the server (`apps/api/src/lib/links.ts`'s
 * `csv-parse`-based `runImport`) owns all real parsing/validation; this
 * helper only needs to construct valid, header-correct CSV *text*.
 */

/**
 * The literal header line `EXPECTED_CSV_COLUMNS` validates against
 * (`apps/web/src/views/LinksImportView.vue`'s `SAMPLE_CSV` constant uses the
 * identical string) -- the SINGLE source of truth every fixture CSV in this
 * phase is built from.
 */
export const IMPORT_CSV_HEADER = "ziel_url,slug,domain";

/** One row of import-CSV input. `slug`/`domain` are optional -- an omitted
 * value renders as an empty cell, deferring to the server's slug-generation
 * fallback / the UI's default-domain selection, exactly like a blank cell in
 * a hand-authored CSV would. */
export type ImportCsvRow = {
  zielUrl: string;
  slug?: string;
  domain?: string;
};

/**
 * RFC 4180 field escaping (14-REVIEW.md WR-02): quote-wraps `value` whenever
 * it contains a comma, a double quote, or a newline (`\n`/`\r`) -- the three
 * characters that would otherwise misalign or corrupt columns in the plain
 * comma-join below -- doubling any embedded `"` per the spec. Every CURRENT
 * call site only ever passes plain `https://example.com/...` URLs and
 * hyphenated slugs (none of which need quoting, so this is a no-op for
 * today's fixtures), but this module's own doc comment positions it as the
 * ONE shared fixture builder every future CSV-import spec will reach for --
 * without this, a future fixture value containing a comma would silently
 * shift columns instead of failing loudly, since the server's own
 * `csv-parse` (`apps/api/src/lib/links.ts`) correctly follows RFC 4180
 * quoting rules on the way in.
 */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a CSV string from `rows`: `IMPORT_CSV_HEADER` first, then one line
 * per row (`zielUrl,slug,domain` in that fixed column order, blank cells for
 * an omitted `slug`/`domain`, each cell passed through `escapeCsvField`),
 * with a trailing newline -- mirroring `LinksImportView.vue`'s `SAMPLE_CSV`
 * shape exactly (including for a zero-row input, whose output is just the
 * header line plus trailing newline).
 */
export function buildImportCsv(rows: ImportCsvRow[]): string {
  const lines = [
    IMPORT_CSV_HEADER,
    ...rows.map((row) =>
      [escapeCsvField(row.zielUrl), escapeCsvField(row.slug ?? ""), escapeCsvField(row.domain ?? "")].join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
