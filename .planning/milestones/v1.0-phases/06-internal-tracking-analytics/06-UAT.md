---
status: complete
phase: 06-internal-tracking-analytics
source:
  - 06-01-SUMMARY.md
  - 06-02-SUMMARY.md
  - 06-03-SUMMARY.md
  - 06-04-SUMMARY.md
  - 06-05-SUMMARY.md
  - 06-06-SUMMARY.md
  - 06-07-SUMMARY.md
  - 06-08-SUMMARY.md
started: "2026-07-20T09:44:47Z"
updated: "2026-07-20T10:12:00Z"
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running API/Web/DB containers. Start the full stack from scratch (docker-compose up). Server boots without errors, the Phase-06 migration applies cleanly, and a primary query (dashboard load / analytics API) returns live data.
result: pass

### 2. Link-Detail Analytics — Pixel-Treue (Surface A)
expected: Öffne eine Link-Detailseite. Die "Internes Tracking"-Karte, der Toggle, das 3er-Stat-Grid, die 30-Balken-Chart-Card und die zweispaltige Referrer/Länder-Liste entsprechen pixelgenau 06-UI-SPEC.md § Surface A — inklusive Skeleton-Größen und korrektem Rendering in Light UND Dark Theme.
result: pass
note: "Initially blocked — served SPA at :3000 was the stale Jul-11 Phase-01 scaffold build. Resolved by rebuilding the app image (docker compose build) so the container serves the current SPA. Visual verification then passed."
source: manual
coverage_id: D6

### 3. Link-Formular & Liste — Tracking-UI Pixel-Treue (§ C1/C2)
expected: Im LinkFormModal-Footer sitzt der "Internes Tracking"-Toggle im space-between-Layout mit korrekten Token; in der LinksView-Tabelle steht die rechtsbündige Klicks-Spalte und der "Tracking aus"-Badge mit korrekter Typografie/Tokens — pixelgenau nach 06-UI-SPEC.md § C1/C2, in Light UND Dark Theme.
result: pass
source: manual
coverage_id: D4

### 4. TRACK-03: GeoIP-DB / ENV-Keys (06-01)
expected: maxmind auflösbar, GEOIP_DB_PATH & CLICK_RETENTION_DAYS als optionale ENV-Keys ohne Default, .env.example drift-frei.
result: pass
source: automated
coverage_id: 06-01/D1-D3

### 5. TRACK-01: Tracking-Schema & Single-Write-Path (06-02)
expected: trackingEnabled/lifetimeClicks/ClickEvent/ScanSource/DailySalt in DB; trackingEnabled läuft über validateLinkInput/createLink/updateLink; lifetimeClicks nicht client-setzbar (Mass-Assignment-Guard).
result: pass
source: automated
coverage_id: 06-02/D1-D3

### 6. TRACK-03: Privacy-Helper (referrer/visitorHash/geoip) (06-03)
expected: normalizeReferrer nur Host; computeVisitorHash deterministisch + salt-rotierend; resolveDailySalt idempotent/race-safe; getCountryForIp degradiert nie werfend; keine fetch/HTTP-Imports; .mmdb im Docker-Build eingebacken.
result: pass
source: automated
coverage_id: 06-03/D1-D6

### 7. TRACK-02/03: Redirect-Tracking Zero-Rows & Hot-Path (06-04)
expected: Tracking-OFF schreibt exakt 0 Zeilen; Tracking-ON genau 1 Zeile pro 302 + atomarer lifetimeClicks-Increment; Bots/expired/locked erreichen Write-Seam nie; Tracking-Fehler bricht Redirect nie ab; Retention-Prune korrekt.
result: pass
source: automated
coverage_id: 06-04/D1-D5

### 8. TRACK-04/05: Analytics-Service & Routen IDOR/Scoping (06-05)
expected: getLinkAnalytics (30-Bucket-Serie, Top-Referrer/Länder); getGlobalAnalytics (uniqueVisitors, activeLinks, domain-scoped, kein Cross-Tenant-Leak); Routen 401/404-identisch/200; alle Queries parameterisiert (Prisma.sql).
result: pass
source: automated
coverage_id: 06-05/D1-D5

### 9. TRACK-01: Tracking-Toggle UI-Logik LinkForm/Liste (06-06)
expected: Footer-Toggle defaultet ON / prefill im Edit; Klicks-Spalte liest lifetimeClicks; "Tracking aus"-Badge + "—" statt Zahl; trackingEnabled forwarded durch create/update.
result: pass
source: automated
coverage_id: 06-06/D1-D3

### 10. TRACK-01/04: Link-Detail Analytics UI-Logik (06-07)
expected: Tracking-Karte ON/OFF-Copy + optimistischer Toggle (kein Success-Toast, Fehler revertiert+toastet); Tracking-off zeigt nur Empty-State ohne API-Call; Data-State 3 Cards/30 Bars/Direkt+Unbekannt-Mapping; Zero/Loading-States exklusiv.
result: pass
source: automated
coverage_id: 06-07/D1-D5

### 11. TRACK-05: Global-Analytics View & Routing (06-08)
expected: GET /api/analytics via getGlobalAnalytics; 4 Stat-Karten inkl QR-Scans 0; 30-Balken-Chart; klickbare Top-Links (→/links/:id); Zero-State (Aktive Links echter Wert); Loading-Skeleton exklusiv; /analytics → AnalyticsView; Web-Typecheck grün.
result: pass
source: automated
coverage_id: 06-08/D1-D6

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
