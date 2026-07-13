---
phase: 06-internal-tracking-analytics
plan: 03
subsystem: api
tags: [privacy, geoip, maxmind, hmac, referrer, docker, tdd]

# Dependency graph
requires:
  - phase: 06-01
    provides: maxmind dependency, GEOIP_DB_PATH/CLICK_RETENTION_DAYS env schema keys
  - phase: 06-02
    provides: ClickEvent/ScanSource/DailySalt Prisma models, Link.trackingEnabled/lifetimeClicks columns
provides:
  - normalizeReferrer (apps/api/src/lib/referrer.ts) — host-only Referer normalization, null on missing/malformed
  - computeVisitorHash + resolveDailySalt (apps/api/src/lib/visitorHash.ts) — HMAC-SHA256 daily-rotating visitor hash
  - getCountryForIp (apps/api/src/lib/geoip.ts) — lazy-singleton local .mmdb country lookup, never throws
  - Dockerfile build-stage bake of the DB-IP Country Lite .mmdb into the runtime image
affects: [06-04 (redirect click hook consumes all three helpers), 06-05 (analytics reads over the resulting country/referrerHost/visitorHash columns)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy singleton reader with .catch(() => null) degradation (geoip.ts) — mirrors lib/domainResolution.ts's lazy-resolve shape, never crashes boot on a missing/corrupt DB"
    - "Injectable-prisma pure transform (resolveDailySalt(prisma)) — testable against the transaction-wrapped test client without a module-level singleton client"
    - "vi.resetModules() + dynamic re-import per test case to exercise a lazy module-level singleton's cold-start and degraded-path branches in isolation"

key-files:
  created:
    - apps/api/src/lib/referrer.ts
    - apps/api/src/lib/visitorHash.ts
    - apps/api/src/lib/geoip.ts
    - apps/api/test/referrer.test.ts
    - apps/api/test/visitorHash.test.ts
    - apps/api/test/geoip.test.ts
    - apps/api/test/fixtures/GeoIP2-Country-Test.mmdb
  modified:
    - Dockerfile

key-decisions:
  - "apps/api/test/geoip.test.ts nutzt MaxMinds eigene offizielle MMDB-Spec-Testdatenbank (Apache-2.0, 19KB) statt zur Testzeit die echte DB-IP-Datei herunterzuladen — deterministisch, kein Netzwerkbedarf beim Testlauf. Dies ist NICHT die Produktions-DB-IP-Datei (die wird ausschließlich zur Docker-Build-Zeit gemäß D-02 gebacken)."
  - "geoip.test.ts setzt vi.resetModules() + dynamischen Re-Import pro Testfall ein, um den lazy-Singleton-Reader (readerPromise, gemerkt nach dem ersten Aufruf) für jeden Testfall (bekannte IP / fehlende DB / unset GEOIP_DB_PATH) frisch zu initialisieren."
  - "result.country.iso_code als exakter Feldpfad empirisch gegen ein reales MMDB-Binary bestätigt (81.2.69.142 -> GB, 50.114.0.1 -> US) — löst RESEARCH Open Question 1 / Assumption A2 auf."
  - "Der Dockerfile-Schritt (curl-Download + gunzip von download.db-ip.com) wurde end-to-end via `docker build --target build` verifiziert — realer Netzwerk-Download erfolgreich, ~8MB .mmdb erzeugt und korrekt in die Runtime-Stage kopiert; löst RESEARCH Assumption A3 empirisch auf statt es als offenes Risiko stehen zu lassen."

patterns-established:
  - "Never-throw-into-hot-path degradation for all three privacy transforms — geoip.ts/referrer.ts/visitorHash.ts each return null/degrade on any malformed/missing input rather than throwing, ready for 06-04's redirect hook to call directly without its own extra guards."

requirements-completed: [TRACK-03]

coverage:
  - id: D1
    description: "normalizeReferrer gibt ausschließlich den Quell-Host zurück (Pfad/Query verworfen), null bei fehlendem/kaputtem Referer (D-07)"
    requirement: "TRACK-03"
    verification:
      - kind: unit
        ref: "apps/api/test/referrer.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "computeVisitorHash liefert einen deterministischen HMAC-SHA256-Hexdigest; identische Eingaben mit unterschiedlichem Salt ergeben unterschiedliche Hashes (Rotationsbeweis, D-06)"
    requirement: "TRACK-03"
    verification:
      - kind: unit
        ref: "apps/api/test/visitorHash.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveDailySalt ist pro UTC-Tag idempotent und race-safe (liest bei simuliertem Unique-Constraint-Konflikt den Gewinner statt zu werfen, D-08)"
    requirement: "TRACK-03"
    verification:
      - kind: unit
        ref: "apps/api/test/visitorHash.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "getCountryForIp löst auflösbare IPs zum ISO-Ländercode auf und degradiert bei privaten/reservierten/malformten IPs sowie fehlender DB zu null, ohne jemals zu werfen (D-04)"
    requirement: "TRACK-03"
    verification:
      - kind: unit
        ref: "apps/api/test/geoip.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Keine der drei Module (referrer.ts, visitorHash.ts, geoip.ts) importiert einen fetch/HTTP-Client — reine lokale Transforms (T-06-3P)"
    requirement: "TRACK-03"
    verification:
      - kind: unit
        ref: "grep -rlE 'fetch\\(|node:http|axios|undici' apps/api/src/lib/{referrer,visitorHash,geoip}.ts (leer)"
        status: pass
      - kind: unit
        ref: "apps/api/test/geoip.test.ts#geoip.ts structural privacy guarantee (T-06-3P)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Dockerfile bäckt die DB-IP Country Lite .mmdb zur Build-Zeit ein und kopiert sie exakt an den von geoip.ts erwarteten Runtime-Pfad (D-02)"
    requirement: "TRACK-03"
    verification:
      - kind: other
        ref: "docker build --target build/runtime -f Dockerfile . (manuell ausgeführt, ~8MB .mmdb erzeugt und kopiert, siehe Decisions)"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-07-13
status: complete
---

# Phase 6 Plan 3: Privacy-Preserving Transforms & Air-Gapped GeoIP-Bake Summary

**Drei rein lokale, nie werfende Datenschutz-Transforms (Referrer-Host-Normalisierung, tagesrotierender HMAC-SHA256-Visitor-Hash, lokale MaxMind-.mmdb-Länderauflösung) plus Docker-Build-Step, der die DB-IP Country Lite .mmdb air-gapped ins Image bäckt.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-13T08:39:00Z
- **Completed:** 2026-07-13T08:57:26Z
- **Tasks:** 3 (2 TDD, 1 Konfiguration)
- **Files modified:** 8 (7 neu, 1 geändert)

## Accomplishments
- `normalizeReferrer` extrahiert ausschließlich den Referrer-Host (WHATWG `URL`, kein Regex) — `null` bei fehlendem/kaputtem Header, nie ein Throw
- `computeVisitorHash` + `resolveDailySalt` liefern einen tagesrotierenden, salted HMAC-SHA256-Visitor-Hash; nur der Hash verlässt das Modul, nie rohe IP/User-Agent
- `getCountryForIp` löst IP-Adressen rein lokal über einen lazy-singleton `.mmdb`-Reader auf und degradiert bei jeder Fehlbedingung (fehlende DB, private/reservierte/malformte IP) zu `null`, ohne je zu werfen
- Dockerfile-Build-Stage lädt die DB-IP Country Lite `.mmdb` herunter und entpackt sie; Runtime-Stage kopiert sie exakt an `geoip.ts`s Default-Pfad — end-to-end mit `docker build` real verifiziert (kein simulierter Test)

## Task Commits

Jeder Task wurde atomar committet:

1. **Task 1 (RED): referrer + visitorHash Tests** - `469b340` (test)
2. **Task 1 (GREEN): referrer + visitorHash Implementierung** - `2f533fa` (feat)
3. **Task 2 (RED): geoip Tests + MMDB-Fixture** - `d4d8edd` (test)
4. **Task 2 (GREEN): geoip Implementierung** - `bda45bb` (feat)
5. **Task 3: Dockerfile GeoIP-Bake** - `590e115` (feat)

_TDD-Gates: Task 1 und Task 2 folgen jeweils dem test(06-03) → feat(06-03) RED/GREEN-Zyklus. Task 3 ist keine TDD-Task (Konfigurationsänderung ohne Verhaltenslogik) und hat entsprechend nur einen feat-Commit, wie im Plan vorgesehen._

## Files Created/Modified
- `apps/api/src/lib/referrer.ts` - `normalizeReferrer(referer): string | null`
- `apps/api/src/lib/visitorHash.ts` - `computeVisitorHash(salt, ip, ua, linkId): string`, `resolveDailySalt(prisma): Promise<string>`
- `apps/api/src/lib/geoip.ts` - `getCountryForIp(ip): Promise<string | null>`, lazy-singleton `.mmdb`-Reader
- `apps/api/test/referrer.test.ts` - Unit-Tests für Host-Extraktion + null-Verhalten
- `apps/api/test/visitorHash.test.ts` - Unit-Tests für HMAC-Determinismus/Rotation + DailySalt-Idempotenz/Race-Safety
- `apps/api/test/geoip.test.ts` - Unit-Tests für Länderauflösung, Degradation, strukturelle No-Fetch-Prüfung
- `apps/api/test/fixtures/GeoIP2-Country-Test.mmdb` - MaxMinds offizielle MMDB-Spec-Testdatenbank (Apache-2.0), NICHT die Produktions-DB-IP-Datei
- `Dockerfile` - Build-Stage-Download/Gunzip der `.mmdb` + Runtime-COPY nach `/prod/api/geo`

## Decisions Made
- Test-Fixture statt Download-at-test-time: `apps/api/test/fixtures/GeoIP2-Country-Test.mmdb` (MaxMinds eigenes offizielles MMDB-Testfile, Apache-2.0, 19KB) committet, um deterministische, netzwerkfreie Tests zu garantieren. Bewusst von der Produktions-DB-IP-Datei getrennt gehalten (die bleibt ausschließlich ein Docker-Build-Artefakt, D-02).
- `vi.resetModules()` + dynamischer Re-Import pro Testfall in `geoip.test.ts`, um den modul-lokalen lazy-Singleton (`readerPromise`) für jeden Testfall (auflösbare DB / fehlende DB / unset `GEOIP_DB_PATH`) unabhängig neu zu initialisieren — sonst würde der zuerst geöffnete Reader für alle nachfolgenden Tests memoized bleiben.
- `result.country.iso_code` als exakter Response-Feldpfad empirisch gegen ein reales MMDB-Binary verifiziert (nicht nur angenommen) — löst RESEARCH Open Question 1 / Assumption A2.
- Der komplette Dockerfile-Schritt (curl-Download von `download.db-ip.com` + `gunzip`) wurde real via `docker build --target build` ausgeführt und verifiziert (nicht nur mit dem `grep`-basierten Acceptance-Check des Plans) — bestätigt RESEARCH Assumption A3 empirisch: kein Bot-Block, produziert eine ~8MB `.mmdb`, die die Runtime-Stage korrekt kopiert.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. `GEOIP_DB_PATH` bleibt optional (Operator-Override, D-03); ohne gesetzten Wert nutzt `geoip.ts` den in dieser Plan gebackenen Standard-Pfad.

## Next Phase Readiness
- Alle drei Helper (`normalizeReferrer`, `getCountryForIp`, `computeVisitorHash`/`resolveDailySalt`) sind bereit für 06-04s `recordClickHook`-Body — jede Funktion degradiert garantiert statt zu werfen, passend zum Redirect-Hot-Path.
- Die gebackene `.mmdb` liegt im Runtime-Image exakt am von `geoip.ts` erwarteten Default-Pfad — 06-04 braucht `GEOIP_DB_PATH` in Produktion nicht zu setzen.
- Kein Blocker für 06-04/06-05.

---
*Phase: 06-internal-tracking-analytics*
*Completed: 2026-07-13*

## Self-Check: PASSED

All 7 created files verified present on disk; all 5 task commit hashes (469b340, 2f533fa, d4d8edd, bda45bb, 590e115) verified in git log.
