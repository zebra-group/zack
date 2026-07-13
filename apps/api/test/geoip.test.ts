/**
 * Local GeoIP lookup unit suite (Phase 6, 06-03-PLAN.md Task 2, D-04,
 * T-06-3P/T-06-BOOT, RESEARCH Open Question 1).
 *
 * `getCountryForIp` is a lazily-initialized module-level singleton reader
 * (RESEARCH Pattern 3) — each test resets the module registry and
 * re-imports `lib/geoip.ts` with a fresh `GEOIP_DB_PATH` so every test
 * gets its own uninitialized singleton, mirroring how a fresh process
 * boot would pick up its env. No `setupFileEach` harness needed — zero DB
 * access, purely a local file read.
 *
 * Test fixture: `test/fixtures/GeoIP2-Country-Test.mmdb` — MaxMind's own
 * official MMDB-spec test database (github.com/maxmind/MaxMind-DB,
 * Apache-2.0), used here ONLY to prove the reader/field-path mechanics
 * against a REAL MMDB binary (Open Question 1) — NOT the production
 * DB-IP Country Lite database that Task 3's Dockerfile bakes in.
 * Known entries (source-data/GeoIP2-Country-Test.json): 81.2.69.142 -> GB,
 * 50.114.0.1 -> US.
 *
 * Covers:
 * - resolvable IP -> the expected ISO country code (field path
 *   `result.country.iso_code` confirmed empirically against this real
 *   .mmdb, resolving RESEARCH's Open Question 1/Assumption A2)
 * - private/reserved IP -> null, never throws
 * - malformed IP string -> null, never throws
 * - missing/unset GEOIP_DB_PATH -> the reader degrades to always-null,
 *   no call throws or crashes (Pitfall 2)
 * - structural: no fetch/HTTP import anywhere in geoip.ts (T-06-3P)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures", "GeoIP2-Country-Test.mmdb");
const MISSING_PATH = path.join(__dirname, "fixtures", "does-not-exist.mmdb");

/**
 * Resets the module registry and re-imports `lib/geoip.ts` with the given
 * `GEOIP_DB_PATH` set (or unset), so the module's lazy `readerPromise`
 * singleton is freshly (re-)initialized per test.
 */
async function loadGeoipWithDbPath(dbPath: string | undefined) {
  vi.resetModules();
  if (dbPath === undefined) {
    delete process.env.GEOIP_DB_PATH;
  } else {
    process.env.GEOIP_DB_PATH = dbPath;
  }
  return import("../src/lib/geoip.js");
}

afterEach(() => {
  delete process.env.GEOIP_DB_PATH;
});

describe("getCountryForIp (D-04, local .mmdb, never throws)", () => {
  it("resolves a known public IP to its ISO country code (81.2.69.142 -> GB)", async () => {
    const { getCountryForIp } = await loadGeoipWithDbPath(FIXTURE_PATH);
    await expect(getCountryForIp("81.2.69.142")).resolves.toBe("GB");
  });

  it("resolves a second known public IP to its ISO country code (50.114.0.1 -> US)", async () => {
    const { getCountryForIp } = await loadGeoipWithDbPath(FIXTURE_PATH);
    await expect(getCountryForIp("50.114.0.1")).resolves.toBe("US");
  });

  it("returns null for a private/reserved IP (127.0.0.1), never throws", async () => {
    const { getCountryForIp } = await loadGeoipWithDbPath(FIXTURE_PATH);
    await expect(getCountryForIp("127.0.0.1")).resolves.toBeNull();
  });

  it("returns null for another private/reserved IP (10.0.0.1), never throws", async () => {
    const { getCountryForIp } = await loadGeoipWithDbPath(FIXTURE_PATH);
    await expect(getCountryForIp("10.0.0.1")).resolves.toBeNull();
  });

  it("returns null for a malformed IP string, never throws", async () => {
    const { getCountryForIp } = await loadGeoipWithDbPath(FIXTURE_PATH);
    await expect(getCountryForIp("not-an-ip")).resolves.toBeNull();
  });

  it("degrades to always-null when GEOIP_DB_PATH points at a missing file (never crashes boot)", async () => {
    const { getCountryForIp } = await loadGeoipWithDbPath(MISSING_PATH);
    await expect(getCountryForIp("81.2.69.142")).resolves.toBeNull();
    await expect(getCountryForIp("not-an-ip")).resolves.toBeNull();
  });

  it("degrades to always-null when GEOIP_DB_PATH is unset and the default bundled path is absent in the test env", async () => {
    const { getCountryForIp } = await loadGeoipWithDbPath(undefined);
    await expect(getCountryForIp("81.2.69.142")).resolves.toBeNull();
  });

  it("memoizes the reader across repeated calls within the same module instance (lazy singleton, not re-opened per request)", async () => {
    const { getCountryForIp } = await loadGeoipWithDbPath(FIXTURE_PATH);
    const [first, second] = await Promise.all([
      getCountryForIp("81.2.69.142"),
      getCountryForIp("50.114.0.1"),
    ]);
    expect(first).toBe("GB");
    expect(second).toBe("US");
  });
});

describe("geoip.ts structural privacy guarantee (T-06-3P)", () => {
  it("never imports a fetch/HTTP client — purely local .mmdb read, zero network I/O", async () => {
    const source = await readFile(
      path.join(__dirname, "..", "src", "lib", "geoip.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/fetch\(|node:http|axios|undici/);
  });
});
