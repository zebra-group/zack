# Phase 4: Links Management & Bulk Import - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Nutzer erstellen, organisieren, durchsuchen und importieren Kurzlinks über ihre Domains — durch **einen** konsistenten, autorisierten Erstellungspfad. Der CSV-Bulk-Import nutzt **exakt dieselben** Validierungs-, Autorisierungs- und Reserved-Slug-Regeln wie das manuelle Anlegen, **nie** einen separaten Bypass.

**Requirements:** LINK-01 (Link erstellen: Domain + Ziel-URL, leerer Slug → auto), LINK-02 (eigener Slug), LINK-03 (Liste durchsuchen + nach Domain filtern), LINK-04 (volle URL kopieren), LINK-05 (Detailseite mit Attributen + Statistiken), LINK-06 (Einstellungen bearbeiten), LINK-07 (löschen), LINK-08 (CSV-Bulk-Import `ziel_url, slug, domain` mit Live-Validierungsvorschau „N gültig · M übersprungen"), UI-06 (Toast-Bestätigungen).

**In scope:** ein geteilter `createLink`-Service/Validator (manuell + Bulk); Slug-Generierung + Kollisions- + Reserved-Slug-Logik; domain-gescopte Link-Liste mit Suche/Filter; Detailseite; Bearbeiten (inkl. Slug mit Warnung); Löschen; CSV-Import mit Validierungsvorschau; Toasts.

**Out of scope (spätere Phasen):** echte Klick-Statistiken (Analytics-Phase — Detailseite zeigt vorerst Platzhalter/Grundgerüst); QR-Codes zu Links (QR-Phase); Passwortschutz/Ablauf von Links; Ordner/erweiterte Organisation über Suchen/Filtern hinaus.
</domain>

<decisions>
## Implementation Decisions

### Ein einziger Erstellungspfad (Kernprinzip)
- **D-01:** Manuelles Anlegen (LINK-01/02) **und** CSV-Bulk-Import (LINK-08) laufen durch **denselben** `createLink`-Service (Validierung + Autorisierung + Slug-/Reserved-Regeln). Der Import ist ein Batch-Aufruf dieses Service, **kein** paralleler Pfad — so kann kein Import ungültige/unautorisierte/reservierte Links durchschmuggeln.

### Slug-Strategie
- **D-02:** Auto-Slug aus **Base62** (`[a-zA-Z0-9]`), ~6–7 Zeichen. Kollision: Auto-Slug → neu würfeln (mit Retry-Limit); Custom-Slug (LINK-02) belegt → **klarer Fehler**. **Reservierte Slugs** (`api`, `health`, `.well-known`, statische Asset-Pfade, App-/System-Routen) werden abgelehnt, damit Links keine System-Routen überschatten (Schutz des Redirect-Cores). Slug ist **unique pro Domain**.

### Link-Autorisierung
- **D-03:** **Alle Domain-Mitglieder** (owner/admin/member) mit Zugriff via `requireDomainAccess(userId, domainId, 'member')` dürfen Links in der Domain **erstellen, bearbeiten und löschen**. Die Link-Liste (LINK-03) ist domain-gescopt über `scopedDomainIds(userId)` — Nutzer sehen nur Links ihrer zugänglichen Domains.

### Bearbeiten & Slug-Editierbarkeit
- **D-04:** Über LINK-06 sind **Ziel-URL, Attribute UND der Slug** editierbar. Eine Slug-Änderung erfolgt mit **deutlicher Warnung**, dass bestehende geteilte Links (und später QR-Codes) darauf brechen. Ein geänderter Slug unterliegt denselben Kollisions-/Reserved-Regeln wie eine Neuanlage.

### CSV-Bulk-Import
- **D-05:** CSV-Spalten `ziel_url, slug, domain`. **Live-Validierungsvorschau** zeigt „N gültig · M übersprungen" (LINK-08) **vor** dem Commit. Gültige Zeilen werden importiert; übersprungen werden (mit Grund): ungültige Ziel-URL, belegter/reservierter Slug, nicht-autorisierte oder unbekannte Domain, Duplikat innerhalb der Datei. Vernünftiges Zeilen-Limit (Discretion).

### UI
- **D-06:** Toast-Bestätigungen (UI-06) für Erstellen, Kopieren (LINK-04, Clipboard), Import und Löschen. Kopieren liefert die **vollständige** URL (`https://<domain>/<slug>`).

### Claude's Discretion
- Exaktes Link-Schema (`domainId` FK, `slug` unique-per-domain, `targetUrl`, `createdBy`, Timestamps, optionale `title`/Tags), Slug-Generator- + Reserved-Liste-Details, CSV-Parsing-Bibliothek + Zeilen-Limit, Such-/Filter-Query, Clipboard-API, und die Platzhalter-Ausgestaltung der Statistik-Sektion auf der Detailseite (echte Zahlen kommen in der Analytics-Phase) — Researcher/Planner.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/PROJECT.md` — Core Value (Redirect-Handler korrekt & schnell), Constraints.
- `.planning/REQUIREMENTS.md` — LINK-01…08, UI-06.
- `.planning/ROADMAP.md` §Phase 4 — Goal & Success Criteria (ein autorisierter Pfad, Bulk = kein Bypass).
- `.claude/CLAUDE.md` — Stack (Fastify/Prisma/Vue), Redirect-Architektur, Open-Redirect-Prävention.
- Phase-2-Artefakte: `requireDomainAccess`/`scopedDomainIds` (einziger Autorisierungspfad).
- Phase-3-Artefakte: das `Domain`-Modell (Links referenzieren `domainId`; nur aktive/zugängliche Domains wählbar).
- Phase-1-Artefakte: der Redirect-Handler-Stub (`apps/api/src/routes/redirect.ts`) — löst später `Host`→Domain→`slug`→Ziel auf; diese Phase legt die `Link`-Records an, die er auflöst. Reservierte Routen (`/health`, `/api/*`) kennen für die Reserved-Slug-Liste.
- `design_handoff_url_shortener/Kurzly Prototyp.dc.html` — Link-Liste, Erstellen-Dialog, Detailseite, Import-UI (pixelgenau).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-2-Autorisierungskern** (`requireDomainAccess`/`scopedDomainIds`) — Link-CRUD + Listen-Scoping nutzen ihn.
- **Phase-3-`Domain`-Modell** — Links hängen an `domainId`; Domain-Auswahl beim Erstellen filtert auf zugängliche/aktive Domains.
- **Phase-1-Redirect-Stub + reservierte Routen** — informieren die Reserved-Slug-Liste und den späteren Auflösungspfad.
- **testcontainers-Harness** — `createLink`-Service, Slug-/Reserved-Logik und CSV-Import gegen echtes Postgres TDD-testen (v. a. „Bulk nutzt denselben Pfad").
- Geteilte DTOs (`packages/shared`) für Link-/Import-Typen zwischen `apps/web` und `apps/api`.

### Integration Points
- Der **eine** `createLink`-Service ist DER Integrationspunkt — manuell + Bulk + (später) API nutzen ihn; Signatur bewusst stabil.
- Die `Link`-Records sind die Datenbasis, die die Redirect-Engine (spätere Phase) per `Host`+`slug` auflöst.
</code_context>

<specifics>
## Specific Ideas

- „Bulk = kein Bypass" ist ein Sicherheits-/Korrektheitsanker: der Import ruft zeilenweise denselben validierten `createLink`-Pfad auf, statt Rohdaten direkt in die DB zu schreiben.
- Reserved-Slug-Schutz verhindert, dass ein Link (z. B. Slug `api` oder `health`) System-Routen überschattet — direkt relevant für den Redirect-Core („wenn alles andere ausfällt, muss der Redirect korrekt funktionieren").
- Slug-Editierbarkeit mit Warnung bereitet das spätere dynamische QR-Remapping vor (Ziel/Slug ändern, QR bleibt).
</specifics>

<deferred>
## Deferred Ideas

- **Echte Klick-Statistiken** auf der Detailseite (LINK-05) — Analytics-Phase; hier nur Attribute + Platzhalter-Statistik-Sektion.
- **QR-Codes zu Links** — QR-Phase.
- **Passwortschutz / Ablaufdatum** von Links — spätere Phase.
- **Ordner/Tags-Organisation** über Suchen/Filtern hinaus — bei Bedarf eigene Phase.
</deferred>

---

*Phase: 4-links-management-bulk-import*
*Context gathered: 2026-07-11*
