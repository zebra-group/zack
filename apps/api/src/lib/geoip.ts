/**
 * Local GeoIP country resolution (Phase 6, D-04, T-06-3P/T-06-BOOT).
 *
 * A lazily-initialized, module-level singleton `.mmdb` reader — opened
 * once, never re-opened per request (mirrors `lib/domainResolution.ts`'s
 * lazy-resolve helper shape). RESEARCH Pitfall 2: if `maxmind.open()` were
 * called eagerly and awaited synchronously without a catch, a missing/
 * misconfigured `GEOIP_DB_PATH` or a Docker build that failed to download
 * the DB would crash the whole app at startup — even though D-04
 * explicitly requires "never an error." The lazy `.catch(() => null)`
 * singleton below degrades to an always-null reader instead.
 *
 * `getCountryForIp` NEVER throws — a missing/corrupt DB, a private/
 * reserved/unmapped IP range, or a malformed IP string all resolve to
 * `null` (D-04: "recorded as Unbekannt, click still counted, never an
 * error, never a skip" — the "Unbekannt" label itself is a DTO/view
 * concern, this function only ever returns the raw ISO code or `null`).
 *
 * Purely a local, in-process file read — no fetch/HTTP import anywhere in
 * this module (privacy guarantee, T-06-3P): the country lookup is never a
 * third-party call.
 */
import maxmind, { type CountryResponse, type Reader } from "maxmind";

const DEFAULT_DB_PATH = "/prod/api/geo/dbip-country-lite.mmdb";

let readerPromise: Promise<Reader<CountryResponse> | null> | null = null;

function resolveDbPath(): string {
  // D-03: optional operator override for a bind-mounted .mmdb; absence
  // means "use the build-baked default" (Task 3's Dockerfile COPY target).
  return process.env.GEOIP_DB_PATH ?? DEFAULT_DB_PATH;
}

function getReader(): Promise<Reader<CountryResponse> | null> {
  if (!readerPromise) {
    readerPromise = maxmind
      .open<CountryResponse>(resolveDbPath())
      .catch(() => null); // missing/corrupt DB -> degrade, never crash boot or a request
  }
  return readerPromise;
}

/**
 * D-04: never throws, never returns an ambiguous shape — `null` means
 * "store as Unbekannt" at the DTO/view boundary.
 */
export async function getCountryForIp(ip: string): Promise<string | null> {
  const reader = await getReader();
  if (!reader) return null;
  try {
    const result = reader.get(ip); // null for private/reserved/unmapped ranges — no throw
    return result?.country?.iso_code ?? null;
  } catch {
    return null; // malformed IP string, etc. — still never throw into the hot path
  }
}
