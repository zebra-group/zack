# Phase 6: Internal Tracking & Analytics - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Nutzer erhalten datenschutzfreundliches, **rein internes** Klick-Tracking — pro Link **und** kontoweit. Kernversprechen: Tracking „aus" für einen Link = **echte Null-Zeilen-Garantie** in der Datenbank (kein Display-Filter, keine geschriebenen Zeilen), **kein einziger Drittanbieter-Call**, und Länder/Referrer werden **lokal** abgeleitet.

**Requirements:** TRACK-01 (Tracking pro Link umschaltbar, Default an), TRACK-02 (bei „aus" null Zeilen geschrieben — DB-verifiziert, kein Display-Filter), TRACK-03 (getrackter Link erfasst Klickanzahl, Referrer, Länder ohne Drittanbieter), TRACK-04 (Per-Link-Analytics: Gesamt, 30-Tage-Zeitreihe, Top-Referrer, Länder), TRACK-05 (globale Übersicht: Klicks, Unique Visitors, aktive Links, QR-Scans, Top-Links, Referrer).

**Mode:** mvp. **Depends on:** Phase 5 (Core Redirect Engine).

**In scope:**
- Füllt die in Phase 5 eingebaute **D-17-Naht** `recordClickHook({ linkId })` in `apps/api/src/routes/redirect.ts` — sie sitzt exakt am erfolgreichen 302-Pfad (`state === "ok"`); Bots, abgelaufene und noch gesperrte Links erreichen sie nie (natürlicher Bot-Ausschluss).
- Neues `ClickEvent`-Modell (Roh-Event pro getracktem Klick) + Schema-Erweiterungen am `Link` (`trackingEnabled` Boolean Default true, `lifetimeClicks` Int Default 0).
- Per-Link-Tracking-Toggle (Default an) im bestehenden Link-Formular/-Detail (Phase 4 UI, ein autorisierter Schreibpfad via `lib/links.ts`).
- Lokale Länder-Ableitung (geo-lookup) und normalisierte Referrer-Erfassung — kein Drittanbieter-Call.
- Datenschutzfreundliche Unique-Visitor-Zählung via täglich rotierendem, gesalzenem Hash (keine Roh-IP/PII at rest).
- Per-Link-Analytics-Ansicht (TRACK-04) + globale Analytics-Übersicht (TRACK-05) im Dashboard, live per SQL aggregiert.
- Optionales, konfigurierbares Retention-Pruning der Roh-Events.

**Out of scope (spätere Phasen):**
- **Tatsächliche QR-Codes / QR-Scan-Schreibpfad** → Phase 7. Phase 6 legt nur das `source`-Feld (link|qr) an; QR-Scans = COUNT(source=qr) = 0 bis Phase 7 den Wert setzt.
- **Member-/Rollen-Autorisierung der Analytics-Endpunkte** (domainspezifische Sichtbarkeit) → Phase 9 (Team Management & Domain-Scoped Authorization). Phase 6 folgt dem bestehenden Autorisierungsmuster, führt aber die Domain-Scoping-Enforcement nicht neu ein.
- Export/CSV der Analytics, Alerting, Echtzeit-Dashboards → nicht Teil des MVP.

</domain>

<decisions>
## Implementation Decisions

### Länder-Ableitung (lokal, kein Drittanbieter) — TRACK-03
- **D-01:** Länder werden über eine **lokale GeoIP-Datenbank** abgeleitet: **DB-IP Country Lite** (Lizenz **CC-BY 4.0**, monatliche Aktualisierung, `.mmdb`-Format). Bewusst gegen MaxMind GeoLite2 entschieden, weil DB-IP **keinen Account/Lizenzschlüssel** erfordert — passt zum „docker compose up"-Anspruch eines self-hosted OSS-Tools. Attribution im Footer/README erforderlich (CC-BY).
- **D-02:** Die DB wird **beim Image-Build ins Docker-Image gebacken** (Download im Build-Step → `/app/geo/…`), damit die Länder-Ableitung offline/air-gapped out-of-the-box funktioniert. Aktualisierung = neuer Image-Build (monatlich).
- **D-03:** **Optionaler `GEOIP_DB_PATH`-ENV** überschreibt die gebündelte DB — Betreiber kann eine eigene/aktuellere `.mmdb` per Volume mounten.
- **D-04:** **Nicht-auflösbare IPs** (localhost, private Netze, unbekannte Range, fehlende DB) → Land wird als **„Unbekannt"** (ISO `XX` o. ä.) erfasst; der **Klick wird trotzdem gezählt** (Referrer/Count/Unique intakt) — nie ein Fehler/Skip.
- **D-05:** Hinter Reverse-Proxy wird die **echte Client-IP** via trust-proxy / `X-Forwarded-For` bestimmt (nicht die Proxy-IP). Konkrete trust-proxy-Konfiguration = Planner/Researcher (Abgleich mit bestehender Fastify-Config aus Phase 3/5).

### Besucher-Datenschutzmodell — TRACK-03/05
- **D-06:** **Unique Visitors** werden via **täglich rotierendem, gesalzenem Hash** gezählt (Plausible-Stil): pro Klick `visitorHash = hash(dailySalt | ip | userAgent | linkId)`. **Nur der Hash wird persistiert** — nie Roh-IP, nie UA-Klartext. Der Tages-Salt rotiert (alter Salt verworfen) → Besucher sind **nicht über Tage hinweg re-identifizierbar**. Kein Tracking-Cookie auf dem öffentlichen Redirect (Consent-frei). Unique = `COUNT(DISTINCT visitorHash)`; das Unique-Fenster ist bewusst **tagesgranular**.
- **D-07:** **Referrer** wird **auf den Quell-Host normalisiert** gespeichert (z. B. `t.co`, `google.com`) — Pfad/Query werden verworfen (kein Leak fremder sensibler URL-Parameter, saubere Top-Referrer-Aggregation). Fehlender/leerer `Referer` → **„Direkt"**.
- **D-08:** Salt-Erzeugung/-Rotation (Persistenz des Tages-Salts, Rotationsmechanik, Hash-Algorithmus) = Planner-Discretion, muss aber die „kein PII at rest / keine Cross-Day-Verfolgung"-Eigenschaft aus D-06 garantieren.

### Event-Datenmodell & Zero-Rows-Garantie — TRACK-02/04/05
- **D-09:** **Eine Roh-`ClickEvent`-Zeile pro getracktem Klick.** Vorgesehene Felder: `linkId`, `createdAt`, `country`, `referrerHost`, `visitorHash`, `source`. Tracking „aus" → `recordClickHook` **schreibt schlicht nichts** (kein INSERT) → **buchstäblich null Zeilen** (TRACK-02 direkt am Schreibpfad erfüllt, kein nachgelagerter Display-Filter). DB-verifizierbar per direktem Row-Count-Test.
- **D-10:** **Analytics = Live-SQL-Aggregation** über die Event-Tabelle: 30-Tage-Zeitreihe via `date_trunc('day')`, Uniques via `COUNT(DISTINCT visitorHash)`, Top-Referrer/Länder via `GROUP BY`. Kein separates Rollup-System für das MVP (Ausnahme: Lifetime-Zähler, D-13).
- **D-11:** **Toggle-off-Verhalten:** Ausschalten stoppt **nur künftige Writes**; bereits erfasste historische Events **bleiben** und bleiben in der Analytics sichtbar. Nicht-destruktiv, keine überraschende Datenlöschung. TRACK-02 bezieht sich auf **neu geschriebene** Zeilen — Semantik bleibt erfüllt.
- **D-12:** **Retention:** **optionaler `CLICK_RETENTION_DAYS`-ENV** (Default: **unbegrenzt/aus**). Wenn gesetzt, löscht ein periodischer Cleanup Events älter als N Tage (datensparsam). Konkreter Cleanup-Mechanismus (Cron/Job/Interval) = Planner-Discretion.
- **D-13:** **Pruning-fester Gesamtzähler:** `Link.lifetimeClicks` (Int, Default 0) wird beim Klick-Write mitinkrementiert. **All-Time-Gesamtklicks kommen aus diesem Zähler** und überleben Pruning; Zeitreihe/Uniques/Top-N/Länder/Referrer aggregieren live über die (ggf. geprunten) Roh-Events. INSERT + Increment sollen konsistent im selben Schreibpfad erfolgen.

### QR-Scans-Naht (Vorbereitung Phase 7) — TRACK-05
- **D-14:** `ClickEvent.source` (Enum `link` | `qr`, **Default `link`**) wird **jetzt schon** ins Schema aufgenommen. Alle Phase-6-Klicks sind `source='link'`. Der Global-Overview zeigt **„QR-Scans" = `COUNT(source='qr')`** → aktuell **0**. Phase 7 setzt beim QR-Redirect nur `source='qr'` — **keine Schema-Änderung/kein Aufreißen** nötig, exakt analog zur D-17-Naht aus Phase 5.

### Toggle & Default — TRACK-01
- **D-15:** Per-Link-Toggle **`Link.trackingEnabled`** (Boolean, **Default `true`**). Umschaltung läuft durch den **einen autorisierten Schreibpfad** (`lib/links.ts` `createLink`/`updateLink`, D-01-Muster aus Phase 5) — kein paralleler Bypass. UI-Integration ins bestehende Link-Formular/-Detail (Phase 4).

### Claude's Discretion
- Konkrete GeoIP-Reader-Bibliothek (z. B. `mmdb-lib`/`maxmind`-npm gegen `.mmdb`), Hash-Algorithmus & Tages-Salt-Persistenz/-Rotation, trust-proxy-Feinkonfiguration, Cleanup-Job-Mechanik für Retention, genauer Aggregations-SQL/Query-Aufbau (raw SQL vs. Prisma-groupBy), Index-Strategie auf `ClickEvent` (`linkId`, `createdAt`, `source`), Aufteilung/Zuschnitt der Analytics-Screens (Per-Link-Tab vs. globale Übersicht) im Rahmen des Prototyp-Designs, ENV-Namensschema-Details.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projekt- & Anforderungsbasis
- `.planning/PROJECT.md` — Core Value (datenschutzfreundliches internes Tracking; kein Drittanbieter-Tracking), „Out of Scope": Drittanbieter-/externes Analytics.
- `.planning/REQUIREMENTS.md` — TRACK-01…TRACK-05 (Traceability, aktuell alle „Pending").
- `.planning/ROADMAP.md` §Phase 6 — Goal & Success Criteria (Null-Zeilen-Garantie DB-verifiziert, keine Drittanbieter-Calls, Per-Link + globale Analytics).
- `.claude/CLAUDE.md` — Stack (Fastify v5 / Prisma 7 / Vue 3), testcontainers-Postgres für DB-verifizierte Zero-Rows-Tests, Docker-Image-Build-Kontext.

### Phasen-Artefakte (Reuse & Naht)
- `apps/api/src/routes/redirect.ts` — **D-17-Naht** `recordClickHook({ linkId })` (Zeile ~58/132), sitzt am `state === "ok"`-302-Pfad; hier landet der Klick-Write. Bot-/Expiry-/Protected-Zweige erreichen die Naht nicht.
- `apps/api/src/lib/links.ts` + `apps/api/src/routes/links.ts` — **ein autorisierter Schreibpfad** (`createLink`/`updateLink`); `trackingEnabled` läuft hier durch (D-15, D-01-Muster aus Phase 5).
- `apps/api/prisma/schema.prisma` — `model Link` (Phase-5-Stand mit `passwordHash`/`expiresAt`/`forwardQuery`); hier kommen `trackingEnabled`, `lifetimeClicks`, das neue `model ClickEvent` und das `ScanSource`-Enum hinzu.
- `apps/api/src/lib/domainResolution.ts` — `resolveActiveDomainByHost()` (eingefrorene Signatur) liefert den Domain-Kontext, in dem der Redirect (und damit der Klick) stattfindet.
- `packages/shared` — geteilte Link-/DTO-Typen; um Analytics-DTOs (Per-Link + global) und `trackingEnabled` erweitern.
- `.planning/phases/05-core-redirect-engine/05-CONTEXT.md` — D-17-Naht-Definition, D-01 „ein autorisierter Schreibpfad", `no-store`-Disziplin, Bot-Ausschluss-Verhalten.

### Design
- `design_handoff_url_shortener/Kurzly Prototyp.dc.html` — maßgeblich für die Per-Link-Analytics-Ansicht und die globale Analytics-Übersicht (Zeitreihe, Top-Referrer, Länder, QR-Scans-Kachel), Light/Dark, Geist-Typo, Lime-Akzent `#d7ff01`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`recordClickHook({ linkId })` (Phase 5, D-17)** — bereits vorhandene, stabile no-op-Naht am erfolgreichen 302-Pfad. Phase 6 ersetzt nur den Body durch den Event-INSERT + `lifetimeClicks`-Increment — der Core-Redirect-Pfad wird nicht neu aufgerissen.
- **`createLink`/`updateLink`-Service (`lib/links.ts`, Phase 4/5)** — ein autorisierter Setz-Pfad; `trackingEnabled` läuft durch dieselbe Zod-Allowlist-Validierung (kein Mass-Assignment).
- **testcontainers-Postgres-Harness** — echtes Postgres für den **DB-verifizierten Zero-Rows-Test** (TRACK-02: nach N Redirects durch einen „aus"-Link → 0 `ClickEvent`-Zeilen, direkt gegen die DB geprüft).
- **`resolveActiveDomainByHost()`** — deny-by-default Host→Domain-Auflösung; unverändert genutzt, der Klick entsteht in diesem Domain-Kontext.
- **Geteilte DTOs (`packages/shared`)** — Link-Typen zwischen `apps/web`/`apps/api`; um `trackingEnabled` + Analytics-Antworttypen erweitern.

### Established Patterns
- **Ein autorisierter Schreibpfad (D-01, Phase 5)** — keine parallelen Bypässe; neue Felder gehen durch `createLink`/`updateLink`.
- **Naht statt Aufreißen (D-17, Phase 5)** — Klick-Write landet an der definierten Stelle; `source`-Feld bereitet die Phase-7-QR-Naht analog vor.
- **Deny-by-default / server-seitige Autorisierung** — Analytics-Abfragen folgen dem bestehenden Muster; die volle domain-scoped Member-Enforcement kommt erst in Phase 9 (hier nicht neu einführen).
- **`no-store` auf Redirect-Antworten (D-18, Phase 5)** — bleibt; Tracking ändert nichts an der Cache-Disziplin.

### Integration Points
- **Klick-Write:** Body von `recordClickHook` in `routes/redirect.ts` (INSERT `ClickEvent` + `Link.lifetimeClicks++`, nur wenn `trackingEnabled`).
- **Toggle-Persistenz:** `trackingEnabled` in `lib/links.ts` + Link-Formular/-Detail (`apps/web`).
- **Analytics-Read:** neue API-Endpunkte (Per-Link + global) mit Live-Aggregation + neue Dashboard-Views/Kacheln nach Prototyp.
- **GeoIP:** neuer lokaler Lookup-Helper (`.mmdb`-Reader) im API, aufgerufen aus dem Klick-Write; DB im Dockerfile-Build-Step.

</code_context>

<specifics>
## Specific Ideas

- **Zero-Rows ist der Prüf-Anker:** TRACK-02 wird DB-seitig bewiesen — „aus"-Link, beliebig oft durchgeklickt, ergibt 0 `ClickEvent`-Zeilen (Row-Count gegen testcontainers-Postgres), nicht nur eine leere UI.
- **Privacy-by-design:** kein Roh-IP/PII at rest — nur täglich-rotierender gesalzener Hash für Uniques, nur Quell-Host für Referrer, „Unbekannt" statt Skip bei GeoIP-Miss.
- **Kein Drittanbieter-Call, nachweisbar:** Länder rein lokal via gebündelter `.mmdb`; funktioniert air-gapped.
- **Zwei Nähte, ein Muster:** wie Phase 5 den Tracking-Hook vorbereitete, bereitet Phase 6 mit `ClickEvent.source` die QR-Scan-Erfassung für Phase 7 vor.
- **Pruning-fest:** `lifetimeClicks`-Zähler trennt „All-Time-Gesamt" von der (prunebaren) Roh-Event-Historie.

</specifics>

<deferred>
## Deferred Ideas

- **QR-Codes / QR-Scan-Schreibpfad** → Phase 7. Phase 6 legt nur `ClickEvent.source` (link|qr) an; QR-Scans-Metrik bleibt bis dahin 0.
- **Domain-scoped Member-Autorisierung der Analytics-Endpunkte** (Mitglieder sehen nur Analytics ihrer zugewiesenen Domains, server-seitig erzwungen inkl. Denial-Test) → Phase 9 (Team Management & Domain-Scoped Authorization Enforcement).
- **Analytics-Export (CSV/API), Alerting, Echtzeit-Streaming, aufwändigere Rollup-/Materialized-View-Performance** → bei Bedarf spätere Phase; MVP nutzt Live-SQL-Aggregation.
- **Referrer-/UTM-Kampagnen-Auswertung über den reinen Quell-Host hinaus** (z. B. Landing-URL-Kampagnendimensionen) → mögliche spätere Analytics-Vertiefung.

</deferred>

---

*Phase: 6-internal-tracking-analytics*
*Context gathered: 2026-07-12*
