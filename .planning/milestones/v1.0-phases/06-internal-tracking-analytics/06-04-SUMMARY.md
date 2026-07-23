---
phase: 06-internal-tracking-analytics
plan: 04
subsystem: api
tags: [fastify, prisma, postgres, redirect-hot-path, privacy, retention, tdd]

requires:
  - phase: 06-internal-tracking-analytics
    provides: "06-02 (ClickEvent/DailySalt/trackingEnabled/lifetimeClicks schema + trackingEnabled threaded through createLink/updateLink), 06-03 (getCountryForIp, normalizeReferrer, computeVisitorHash/resolveDailySalt privacy-first transforms)"
provides:
  - "recordClickHook: the redirect hot path's D-17 seam filled with an atomic, privacy-first ClickEvent write"
  - "Structural zero-rows-when-off guarantee for TRACK-02, DB-row-count-proven"
  - "lib/retention.ts: pruneClickEvents + pruneDailySalts, wired as a daily server.ts scheduler (D-12)"
affects: [06-05-analytics-read-api, 06-verification]

tech-stack:
  added: []
  patterns:
    - "Seam-fill discipline: recordClickHook's body replaced in place, single call site untouched, signature extended to close over the already-fetched link (no re-query)"
    - "Never-throw-into-hot-path: the entire tracking write wrapped in try/catch, swallow-and-warn on failure, redirect always fires"
    - "Atomic counter+event write via a single prisma.$transaction batch (no drift)"
    - "Directly-testable pruning functions (pruneClickEvents/pruneDailySalts), scheduler is a thin setInterval wrapper never exercised by tests"

key-files:
  created:
    - apps/api/src/lib/retention.ts
    - apps/api/test/redirect-tracking.integration.test.ts
    - apps/api/test/retention.test.ts
  modified:
    - apps/api/src/routes/redirect.ts
    - apps/api/src/lib/links.ts
    - apps/api/src/server.ts

key-decisions:
  - "recordClickHook's lifetimeClicks increment is a second, intentional prisma.link.update call site alongside lib/links.ts's updateLink — documented explicitly in both files' header comments as scoped to the counter only, never link content fields"
  - "The plan's literal verify grep (grep -rc 'clickEvent.create' apps/api/src) over-counts generated-client doc comments and this file's own prose; corrected to the codebase's established comment-filtered, generated-dir-excluded convention (04-02-PLAN.md's precedent) to prove the real single-call-site invariant"
  - "retention.ts reads CLICK_RETENTION_DAYS directly from process.env (not loadEnv()), mirroring geoip.ts/redirect.ts's brandCtx convention, so it's testable without a boot-time ENV parse"

requirements-completed: [TRACK-02, TRACK-03]

coverage:
  - id: D1
    description: "Tracking-OFF link produces exactly 0 ClickEvent rows after N redirects (structural early-return, DB-row-count proven), lifetimeClicks stays 0"
    requirement: "TRACK-02"
    verification:
      - kind: integration
        ref: "apps/api/test/redirect-tracking.integration.test.ts#TRACK-02: tracking-OFF link writes literally zero rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tracking-ON link records exactly one ClickEvent per successful 302 with country/referrerHost/visitorHash/source populated, and Link.lifetimeClicks increments atomically with no drift across N clicks"
    requirement: "TRACK-03"
    verification:
      - kind: integration
        ref: "apps/api/test/redirect-tracking.integration.test.ts#TRACK-03: tracking-ON link records one privacy-safe row per 302"
        status: pass
    human_judgment: false
  - id: D3
    description: "Toggling tracking off preserves prior events (D-11); bots/expired/still-locked-protected links never reach the write seam"
    verification:
      - kind: integration
        ref: "apps/api/test/redirect-tracking.integration.test.ts#D-11 + Non-tracked branches"
        status: pass
    human_judgment: false
  - id: D4
    description: "A tracking write failure (forced GeoIP fault) never breaks the redirect — the 302 still fires"
    verification:
      - kind: integration
        ref: "apps/api/test/redirect-tracking.integration.test.ts#Never-throw-into-hot-path (T-06-HOTPATH)"
        status: pass
    human_judgment: false
  - id: D5
    description: "pruneClickEvents deletes only events older than CLICK_RETENTION_DAYS, leaves lifetimeClicks untouched, and is a no-op when unset; pruneDailySalts removes only salts older than the ~2-day window"
    requirement: "TRACK-02"
    verification:
      - kind: integration
        ref: "apps/api/test/retention.test.ts"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-07-13
status: complete
---

# Phase 6 Plan 04: Klick-Aufzeichnung im Redirect-Hot-Path & Retention-Pruning Summary

**`recordClickHook` schreibt genau einen privacy-first ClickEvent pro getrackten 302 (atomarer `$transaction`-Batch mit `lifetimeClicks`-Increment) und literal null Zeilen bei deaktiviertem Tracking — DB-row-count-bewiesen — plus ein täglicher Retention-Pruner (`pruneClickEvents`/`pruneDailySalts`), der rohe Events nach `CLICK_RETENTION_DAYS` löscht, ohne den Zähler oder die Tages-Salts vorzeitig anzutasten.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-13T10:06:22Z
- **Tasks:** 2
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- Der Phase-5-Seam `recordClickHook` in `routes/redirect.ts` ist gefüllt: strukturaler Early-Return bei `!link.trackingEnabled` vor jedem Prisma-Aufruf (TRACK-02, per direktem DB-Zeilenzähler bewiesen, keine reine Anzeige-Filterung), gefolgt von `getCountryForIp`/`normalizeReferrer`/`resolveDailySalt`/`computeVisitorHash` und einem einzigen `prisma.$transaction`, das den `ClickEvent`-Insert und das `Link.lifetimeClicks`-Increment atomar zusammenfasst (D-13, kein Drift).
- Der komplette Hook-Körper ist in try/catch gekapselt — ein erzwungener GeoIP-Fehler in einem dedizierten Test beweist, dass der Redirect trotzdem mit 302 antwortet (T-06-HOTPATH, never-throw-into-hot-path).
- `lib/retention.ts` liefert `pruneClickEvents` (löscht nur Events älter als `CLICK_RETENTION_DAYS`, No-op mit Rückgabe 0 wenn die ENV-Variable fehlt/ungültig ist, rührt `lifetimeClicks` nie an) und `pruneDailySalts` (löscht Salts älter als ~2 UTC-Tage bedingungslos, unabhängig von `CLICK_RETENTION_DAYS` — Open Question 2's Cross-Day-Re-Identifikations-Schutz).
- `server.ts` startet nach erfolgreichem `app.listen` einen einfachen täglichen `setInterval` (plus einen sofortigen Lauf beim Boot) für beide Prune-Funktionen.

## Task Commits

Jeder Task wurde atomar committet (RED → GREEN je Task, gemäß mandatory TDD):

1. **Task 1: Fill recordClickHook** — `0dd8c67` (test, RED) → `42972d6` (feat, GREEN)
2. **Task 2: retention.ts + server.ts scheduler** — `20be966` (test, RED) → `e0243f0` (feat, GREEN)

_Kein separater refactor-Commit nötig — beide Implementierungen wurden GREEN ohne Nacharbeit._

## Files Created/Modified

- `apps/api/src/routes/redirect.ts` — `recordClickHook`-Signatur erweitert (`{ prisma, link, ip, userAgent, referer, log }`), Body gefüllt (Guard → try/catch → `$transaction`), Call-Site aktualisiert, READS-ONLY-Header-Kommentar auf die neue, eng begrenzte Schreib-Ausnahme angepasst
- `apps/api/src/lib/links.ts` — Header-Kommentar präzisiert: `updateLink` bleibt die einzige Stelle für Link-*Inhalts*felder; `recordClickHook`s `lifetimeClicks`-Increment ist eine bewusste, dokumentierte zweite `prisma.link.update`-Stelle
- `apps/api/src/lib/retention.ts` — neu: `pruneClickEvents`, `pruneDailySalts`
- `apps/api/src/server.ts` — täglicher Scheduler nach `app.listen` (Boot-Lauf + 24h-Intervall)
- `apps/api/test/redirect-tracking.integration.test.ts` — neu: 8 Integrationstests (Zero-Rows-Off, Tracking-On Single/N, D-11 Toggle, Bot/Expired/Protected-Zero-Rows, Fault-Injection)
- `apps/api/test/retention.test.ts` — neu: 3 Integrationstests (Prune-mit-Retention, No-op-ohne-ENV, Salt-Pruning)

## Decisions Made

- **Zweite `prisma.link.update`-Stelle bewusst dokumentiert statt vermieden:** Der Plan verlangt explizit den atomaren `$transaction`-Batch aus `clickEvent.create` + `link.update({ lifetimeClicks: increment })` in `recordClickHook`. Das kollidiert wörtlich mit `links.ts`s bisherigem Header-Anspruch "`updateLink` ist die EINZIGE `prisma.link.update`-Stelle". Da kein automatisierter Grep-Test diese Eins-Stelle-Invariante bisher erzwingt (geprüft), wurde die Doku in beiden Dateien präzisiert statt die Architektur zu verbiegen — die Ausnahme ist eng, grep-beweisbar auf `lifetimeClicks` beschränkt und passt zum Plan-Prohibitions-Text (der nur eine zweite `clickEvent.create`-Stelle verbietet, keine zweite `link.update`-Stelle).
- **Verify-Grep korrigiert (Rule 3 — blocking issue):** Der Plan-Verify-Befehl `grep -rc "clickEvent.create" apps/api/src` zählt auch Doc-Kommentare im generierten Prisma-Client (`src/generated/`) und die eigene Prosa in den neuen Header-Kommentaren mit — Ergebnis 7 statt 1. Angewendet wurde stattdessen die im Repo etablierte Konvention aus `04-02-PLAN.md` (`grep -rvE '^\s*(//|\*|/\*)' ... | grep -v '/generated/' | grep -c 'clickEvent\.create('`), die korrekt genau 1 echte Aufrufstelle bestätigt.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan-Verify-Grep über-zählte generierten Client + Prosa-Kommentare**
- **Found during:** Task 1 Verifikation
- **Issue:** `grep -rc "clickEvent.create" apps/api/src | awk ...` zählte 7 Treffer statt der erwarteten 1 (4× Doc-Kommentare in `src/generated/prisma/models/ClickEvent.ts`, 2× eigene Header-Prosa in `redirect.ts`, 1× echter Call).
- **Fix:** Kommentar-gefiltertes, `generated/`-ausschließendes Grep verwendet (Repo-Konvention aus 04-02-PLAN.md), das den echten Single-Call-Site-Beweis liefert.
- **Files modified:** keine Code-Änderung nötig, nur die Verifikationsmethode korrigiert
- **Verification:** `test "$(grep -rvE '^\s*(//|\*|/\*)' apps/api/src --include='*.ts' | grep -v '/generated/' | grep -c 'clickEvent\.create(')" = "1"` → OK
- **Committed in:** kein eigener Commit nötig (Verifikationsschritt, kein Code)

**2. [Rule 1/3 - Doc accuracy] `links.ts`-Header präzisiert für die zweite `link.update`-Stelle**
- **Found during:** Task 1
- **Issue:** `links.ts`s Header behauptete, `updateLink` sei die *einzige* `prisma.link.update`-Stelle im Codebase — durch den neuen `recordClickHook`-Transaction-Aufruf würde diese Aussage falsch/irreführend.
- **Fix:** Header in `links.ts` und `redirect.ts` um eine explizite, eng begrenzte Ausnahme ergänzt (nur `lifetimeClicks`, nie Inhaltsfelder).
- **Files modified:** `apps/api/src/lib/links.ts`, `apps/api/src/routes/redirect.ts`
- **Verification:** manuelle Review; kein automatisierter Grep-Test erzwingt die alte Eins-Stelle-Aussage (bestätigt per Suche)
- **Committed in:** `42972d6` (Task 1 GREEN-Commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/verification, 1 documentation accuracy)
**Impact on plan:** Beide Anpassungen betreffen ausschließlich Doku/Verifikationsmethode, keine funktionale Abweichung vom geplanten Verhalten. Kein Scope Creep.

## Issues Encountered

- Ein voller `pnpm exec vitest run` (alle ~112 Testsuiten parallel) zeigte 14 Fehlschläge quer über mehrere, von diesem Plan unberührte Integrationstestdateien (`analytics.test.ts`, `links.integration.test.ts`, `server.integration.test.ts`, `redirect.integration.test.ts` u.a.). Isolierte Läufe (einzelne Dateien bzw. kleine Gruppen) liefen alle grün mit Exit-Code 0. Das deckt sich exakt mit der in `.planning/phases/06-internal-tracking-analytics/deferred-items.md` dokumentierten WSL2-Testcontainer-Kontention unter Volllast ("contention flakes, not regressions") — keine echte Regression durch diesen Plan. Alle für 06-04 relevanten Dateien (`redirect-tracking.integration.test.ts`, `retention.test.ts`, `redirect.integration.test.ts`) wurden isoliert mehrfach grün verifiziert.

## User Setup Required

None - keine externe Service-Konfiguration nötig. `CLICK_RETENTION_DAYS` ist bereits seit 06-01 optional in `env.ts` definiert (Default = Pruning aus); Betreiber können es optional in ihrer `.env` setzen, um Retention zu aktivieren.

## Next Phase Readiness

- Der Redirect-Hot-Path schreibt jetzt echte, privacy-safe Klick-Daten — 06-05 (Analytics Read API) kann direkt gegen reale `ClickEvent`-Zeilen und den `lifetimeClicks`-Zähler aggregieren.
- Retention-Pruning ist einsatzbereit, aber standardmäßig aus (kein Datenverlust bei frischer Installation ohne explizite ENV-Konfiguration).
- Kein Blocker für nachfolgende Pläne.

---
*Phase: 06-internal-tracking-analytics*
*Completed: 2026-07-13*

## Self-Check: PASSED

All 6 created/modified files found on disk; all 4 task commits (`0dd8c67`, `42972d6`, `20be966`, `e0243f0`) found in git log.
