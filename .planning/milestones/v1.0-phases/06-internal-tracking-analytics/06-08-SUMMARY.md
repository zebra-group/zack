---
phase: 06-internal-tracking-analytics
plan: 08
subsystem: ui
tags: [vue3, vue-router, vitest, vue-test-utils, analytics]

requires:
  - phase: 06-internal-tracking-analytics
    provides: "06-05's GET /api/analytics endpoint (getGlobalAnalytics service, scopedDomainIds-scoped) and its GlobalAnalyticsDTO; 06-07's Surface A skeleton/zero/data 3-state pattern and locked tokens in LinkDetailView.vue"
provides:
  - "AnalyticsView.vue — die globale Analytics-Übersicht (Surface B) unter /analytics"
  - "getGlobalAnalytics() typed client method in apps/web/src/api.ts"
  - "Router-Swap /analytics: ComingSoonView → AnalyticsView"
affects: [phase-07-qr-codes]

tech-stack:
  added: []
  patterns:
    - "Global-Analytics-View wiederholt exakt Surface A's 3-Zustands-Muster (loading skeleton / zero-data / data), inkl. der per-view toast-ref-Konvention statt eines globalen Stores"
    - "toListRows()-Helper generalisiert (countOf/idOf-Callbacks statt fixem 'count'-Feld), damit sowohl { count } (Referrer) als auch { clicks } (Top-Links) dieselbe Zeilen-Bar-Skalierungslogik nutzen"

key-files:
  created:
    - apps/web/src/views/AnalyticsView.vue
    - apps/web/src/views/AnalyticsView.test.ts
  modified:
    - apps/web/src/api.ts
    - apps/web/src/router/index.ts

key-decisions:
  - "toListRows() generalisiert von einem fixen { count: number }-Constraint auf countOf/idOf-Callback-Parameter, weil GlobalAnalyticsDTO.topLinks das Feld 'clicks' (nicht 'count') trägt — Surface A's Original-Helper (LinkDetailView.vue) blieb unverändert, da dort beide Listen (Referrer/Länder) bereits 'count' nutzen"
  - "Router-Registrierungstest ('the real app router resolves /analytics to AnalyticsView') lebt im selben AnalyticsView.test.ts statt einer separaten Router-Testdatei — importiert den echten apps/web/src/router/index.ts und vergleicht die Komponentenreferenz gegen ComingSoonView, um einen künftigen versehentlichen Revert zu fangen"

requirements-completed: [TRACK-05]

coverage:
  - id: D1
    description: "GET /api/analytics per getGlobalAnalytics() im typed client konsumiert"
    requirement: "TRACK-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/AnalyticsView.test.ts#data state: 4 stat cards incl QR-Scans '0', 30 chart bars, clickable Top-Links rows, Referrer list"
        status: pass
    human_judgment: false
  - id: D2
    description: "4 Stat-Karten (Klicks 30 Tage, Unique Visitors, Aktive Links, QR-Scans), 30-Balken-Chart, klickbare Top-Links-Liste, Referrer-Liste — Data State"
    requirement: "TRACK-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/AnalyticsView.test.ts#data state: 4 stat cards incl QR-Scans '0', 30 chart bars, clickable Top-Links rows, Referrer list"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/AnalyticsView.test.ts#clicking a Top-Links row navigates to /links/:id"
        status: pass
    human_judgment: false
  - id: D3
    description: "Zero-Data-State: alle 4 Kacheln zeigen 0 AUSSER Aktive Links (echter Wert, nie auf 0 gezwungen); Chart-Hinweis + 'Keine Daten'-Listen"
    requirement: "TRACK-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/AnalyticsView.test.ts#zero-data state: 4 stat cards with 0 EXCEPT Aktive Links (real count), chart hint, 'Keine Daten' lists"
        status: pass
    human_judgment: false
  - id: D4
    description: "Loading-Skeleton (kein Spinner), die drei Zustände sind gegenseitig exklusiv"
    requirement: "TRACK-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/AnalyticsView.test.ts#loading state: shows skeleton blocks (no spinner) while analytics fetches, never alongside data/zero-data"
        status: pass
    human_judgment: false
  - id: D5
    description: "/analytics routet auf AnalyticsView (nicht mehr ComingSoonView), requiresAuth unverändert"
    requirement: "TRACK-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/AnalyticsView.test.ts#the real app router resolves /analytics to AnalyticsView (not ComingSoonView) with requiresAuth"
        status: pass
    human_judgment: false
  - id: D6
    description: "Web-Typecheck grün (tsc --noEmit)"
    verification:
      - kind: other
        ref: "pnpm --filter @kurzly/web exec tsc --noEmit"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-07-13
status: complete
---

# Phase 6 Plan 08: Global Analytics Overview Summary

**Globale Analytics-Übersicht (`AnalyticsView.vue`) ersetzt `ComingSoonView` unter `/analytics` — 4 Stat-Kacheln, 30-Balken-Chart und klickbare Top-Links-/Referrer-Listen aus `GET /api/analytics` (06-05), mit exakt Surface A's Loading-/Zero-Data-/Data-Zustandsmuster.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-13T10:19:00Z
- **Completed:** 2026-07-13T10:28:46Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `getGlobalAnalytics()` in `apps/web/src/api.ts` — typisierter Client für `GET /api/analytics`, folgt dem bestehenden `parseJsonOrThrow<T>`-Muster
- `AnalyticsView.vue`: Header ("Analytics" / "alle Links · letzte 30 Tage"), 4 Stat-Kacheln (Klicks 30 Tage, Unique Visitors, Aktive Links, QR-Scans), 150px-Balkenchart ("Klicks gesamt"), Top-Links-Liste (klickbar → `/links/:id`) und Referrer-Liste — alle drei Zustände (Loading-Skeleton / Zero-Data / Data) exakt gegenseitig exklusiv, exakt dieselben gesperrten Prototyp-Tokens wie Surface A (`LinkDetailView.vue`, 06-07)
- QR-Scans-Kachel liest den echten `qrScans`-Wert aus der DTO als normale Metrik (aktuell immer 0, D-14) — keine Sonder-Copy
- Aktive-Links-Kachel liest `activeLinks` unabhängig vom Klickstand, auch im Zero-Data-Zweig nie auf 0 erzwungen
- Router-Swap: `/analytics` → `AnalyticsView` (ersetzt `ComingSoonView`), `meta.requiresAuth`/`label` unverändert; `qr-codes`/`team` bleiben unangetastet auf `ComingSoonView`

## Task Commits

Each task was committed atomically:

1. **Task 1: getGlobalAnalytics client + AnalyticsView global overview (Surface B, TRACK-05)** - `5e07302` (feat)
2. **Task 2: Router swap /analytics → AnalyticsView** - `97f0285` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/src/api.ts` - `getGlobalAnalytics(): Promise<GlobalAnalyticsDTO>` hinzugefügt (GET /api/analytics)
- `apps/web/src/views/AnalyticsView.vue` - neue globale Analytics-Ansicht (Surface B)
- `apps/web/src/views/AnalyticsView.test.ts` - Komponenten- + Router-Registrierungstests (6 Tests)
- `apps/web/src/router/index.ts` - `/analytics` routet jetzt auf `AnalyticsView` statt `ComingSoonView`

## Decisions Made
- `toListRows()`-Helper (nur in `AnalyticsView.vue`, kein Shared-Refactor) generalisiert auf `countOf`/`idOf`-Callbacks statt eines fixen `{ count: number }`-Constraints, weil `GlobalAnalyticsDTO.topLinks` das Feld `clicks` trägt (nicht `count`) — mit dem starren Constraint aus Surface A wären Top-Links-Zeilen als leere Strings gerendert worden (in der ersten Testrunde empirisch aufgefallen und korrigiert, siehe Deviations)
- Der Router-Registrierungstest lebt im selben `AnalyticsView.test.ts` (nicht in einer separaten Router-Testdatei) — importiert den echten `router/index.ts` und vergleicht die Komponentenreferenz explizit gegen `ComingSoonView`, damit ein künftiger versehentlicher Revert zuverlässig auffliegt

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] toListRows()-Constraint auf `count` passte nicht zu topLinks' `clicks`-Feld**
- **Found during:** Task 1 (erster Testlauf von AnalyticsView.test.ts)
- **Issue:** Der aus Surface A übernommene `toListRows<T extends { count: number }>`-Helper griff bei `analytics.value?.topLinks` (Feld heißt `clicks`, nicht `count`) auf `e.count` zu — `undefined`, wodurch Top-Links-Zeilen leere Klickzahlen statt der echten Werte rendern
- **Fix:** Helper auf `countOf`/`idOf`-Callback-Parameter generalisiert; Top-Links-Aufruf übergibt `(l) => l.clicks`/`(l) => l.id`, Referrer-Aufruf weiterhin `(r) => r.count`
- **Files modified:** apps/web/src/views/AnalyticsView.vue
- **Verification:** `pnpm --filter @kurzly/web test -- src/views/AnalyticsView.test.ts` — alle 6 Tests grün, insbesondere die Top-Links-Klickzahlen-Assertion
- **Committed in:** 5e07302 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 Bug)
**Impact on plan:** Reiner Bugfix vor dem ersten grünen Testlauf, kein Scope-Creep, keine Auswirkung auf die geplante Struktur.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TRACK-05 vollständig geliefert; Phase 6 (internal-tracking-analytics) ist mit diesem Plan abgeschlossen (8/8 Pläne)
- QR-Scans-Kachel ist bereits verdrahtet und zeigt automatisch echte Werte, sobald Phase 7 anfängt, `source='qr'`-Zeilen zu schreiben (D-14-Naht, keine Änderung an AnalyticsView.vue nötig)
- Kein Blocker für Phase 7 (QR-Codes)

---
*Phase: 06-internal-tracking-analytics*
*Completed: 2026-07-13*

## Self-Check: PASSED

- FOUND: apps/web/src/api.ts
- FOUND: apps/web/src/views/AnalyticsView.vue
- FOUND: apps/web/src/views/AnalyticsView.test.ts
- FOUND: apps/web/src/router/index.ts
- FOUND commit: 5e07302
- FOUND commit: 97f0285
