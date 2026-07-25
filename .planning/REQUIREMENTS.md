# Requirements: Kurzly — Milestone v1.1 (E2E Test Coverage)

**Defined:** 2026-07-24
**Core Value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking. Wenn alles andere ausfällt, muss der Redirect-Handler korrekt und schnell funktionieren.

**Milestone scope note:** Dieses Milestone liefert keine neuen Produkt-Features — es erweitert die bestehende Vitest-Unit-/Integrationssuite (540 API- + 256 Web-Tests) um eine echte Playwright-E2E-Suite für alle kritischen v1.0-User-Flows. Die "Requirement"-Granularität ist daher **E2E-Testszenario**, nicht Produktfunktion.

## v1.1 Requirements

### E2E-Infrastruktur

- [x] **INFRA-01**: Playwright ist als eigenes pnpm-Workspace-Paket (`apps/e2e`) eingerichtet und läuft gegen das gebaute Docker-Image (nicht gegen separate Dev-Server)
- [x] **INFRA-02**: Mailpit läuft als SMTP-Catcher-Service in `docker-compose.dev.yml`, per HTTP-API aus Playwright-Tests auslesbar (Magic-Link-/Invite-Mails)
- [x] **INFRA-03**: E2E-Testlauf hat eine isolierte, wiederherstellbare Postgres-Instanz (getrennt vom bestehenden Vitest-Testcontainers-Setup), inkl. Reset-/Seed-Strategie zwischen Testdateien
- [x] **INFRA-04**: Ein wiederverwendbares `storageState`-Auth-Fixture (pro Rolle: Admin/Mitglied) erspart jeder nachgelagerten Test-Suite einen erneuten Login-Roundtrip
- [x] **INFRA-05**: CI führt die Playwright-Suite als eigener Job nach dem bestehenden Test-/Build-Job aus, inkl. Report-/Trace-Artifact-Upload bei Fehlschlägen
- [x] **INFRA-06**: `@fastify/rate-limit` blockiert die E2E-Suite nicht (dedizierter Test-Bypass, keine pauschale Deaktivierung)

### Auth E2E

- [x] **AUTH-E2E-01**: Magic-Link-Login-Roundtrip (Mail anfordern → in Mailpit lesen → Link öffnen → Session aktiv)
- [x] **AUTH-E2E-02**: Ungültiger/abgelaufener Magic-Link-Token wird abgelehnt, keine Session entsteht
- [x] **AUTH-E2E-03**: Nicht eingeladene E-Mail-Adresse erzeugt keine Session (invite-only bewiesen)
- [x] **AUTH-E2E-04**: OIDC/SSO-Login-Roundtrip gegen einen Test-IdP, inkl. Least-Privilege-Provisionierung ("Mitglied") bei Erstanmeldung
- [ ] **AUTH-E2E-05**: Bereits eingeladener, noch nicht aktivierter Magic-Link-Account meldet sich erstmals per SSO an — Konten werden korrekt zusammengeführt
- [x] **AUTH-E2E-06**: Logout beendet die Session; nicht authentifizierter Zugriff auf Dashboard-Routen leitet zum Login um
- [x] **AUTH-E2E-07**: Magic-Link-Resend-Rate-Limit zeigt eine sinnvolle UI-Meldung statt eines stillen Fehlers

### Redirect-Handler E2E

- [x] **REDIRECT-E2E-01**: Slug → Ziel Happy Path (3xx + korrekter `Location`-Header/finale URL)
- [x] **REDIRECT-E2E-02**: Passwort-Gate — falsches Passwort abgelehnt, korrektes Passwort gibt frei; Ziel taucht vor Freigabe in keiner Response auf
- [x] **REDIRECT-E2E-03**: Expiry-Gate — abgelaufener Link liefert HTTP 410, Ziel wird nicht geleakt
- [x] **REDIRECT-E2E-04**: Bot-/OG-Rendering zeigt die konfigurierten Custom-OG-Werte, nie das echte Ziel, und respektiert Passwort-/Expiry-Gates
- [x] **REDIRECT-E2E-05**: UTM-/Query-Parameter erscheinen korrekt zusammengeführt auf der finalen Redirect-URL

### Links & CSV-Import E2E

- [ ] **LINKS-E2E-01**: Kanonische Journey — Link anlegen, in der Liste sehen, bearbeiten, per Suche/Filter finden, löschen
- [ ] **LINKS-E2E-02**: CSV-Bulk-Import Happy Path — Upload → Preview (korrekte Zeilenzahl/Diff) → Commit schreibt exakt die vorgeschauten Zeilen
- [ ] **LINKS-E2E-03**: CSV-Import mit Slug-Konflikt — Preview zeigt den Konflikt korrekt an, Commit verhält sich wie spezifiziert (skip/overwrite)

### QR Studio E2E

- [ ] **QR-E2E-01**: Statische QR-Generierung inkl. Customization (Farbe/Rundung/Logo) mit Decode-Roundtrip auf die Ziel-URL
- [ ] **QR-E2E-02**: Dynamisches QR-Remapping — `/q/:code` löst zunächst zu Ziel A auf, nach Remap in der Studio-UI zu Ziel B, Remap-Historie wird erfasst
- [ ] **QR-E2E-03**: PNG- und SVG-Export liefern jeweils eine gültige, herunterladbare Datei

### Analytics E2E

- [ ] **ANALYTICS-E2E-01**: Ein echter getrackter Redirect-Klick erscheint in der Pro-Link-Analytics-Ansicht
- [ ] **ANALYTICS-E2E-02**: Tracking-Toggle aus → Redirect erzeugt nachweislich keine neue Tracking-Zeile (Zero-Rows)
- [ ] **ANALYTICS-E2E-03**: Globale (Cross-Link-)Analytics-Übersicht rollt Zahlen aus mehreren Links korrekt auf

### Team-Management E2E

- [ ] **TEAM-E2E-01**: Invite → Annahme (Magic-Link-artige Zustellung) → neues Mitglied erscheint in der Team-Liste
- [ ] **TEAM-E2E-02**: Rollen-/Domain-Zuweisung eines Admins wirkt sich in der Session des betroffenen Mitglieds real aus
- [ ] **TEAM-E2E-03**: Entfernen eines Mitglieds widerruft dessen aktive Session sofort (nicht erst beim nächsten Login-Versuch)

### Domain-Autorisierung E2E

- [ ] **AUTHZ-E2E-01**: Für je einen Ressourcentyp (Link, QR, Analytics) beweist ein UI-Layer-Test, dass eine echte, ohne Domain-Zuweisung agierende Mitglieder-Session serverseitig abgelehnt wird (ergänzt, dupliziert nicht die bestehende Integration-Denial-Suite)
- [ ] **AUTHZ-E2E-02**: Ein Account-Admin greift über die UI auf eine ihm nie explizit zugewiesene Domain zu (Bypass-Nachweis)

## Out of Scope

Explizit ausgeschlossen für dieses Milestone — bewusst auf andere Testebenen verlagert, um die E2E-Suite schnell und wartbar zu halten.

| Feature | Reason |
|---------|--------|
| Exhaustive Validierungsfehler-Meldungen (Slug-/URL-Format, Passwortregeln, CSV-Spalten-Mismatch etc.) | Reine, synchrone Logik ohne Integrationsrisiko — gehört in Unit-Tests der Validatoren, nicht in E2E |
| Vollständige Domain-Denial-Matrix (jede Rolle × jede Ressource × jede Operation) | Bereits vollständig durch die bestehende v1.0-Integration-Denial-Suite bewiesen (fastify.inject); E2E dupliziert nur die repräsentativen Fälle (AUTHZ-E2E-01/02) |
| Vollständige QR-Style-/Farb-/Logo-Permutationsmatrix | Kombinatorische Explosion nahezu identischer Journeys; Rendering-Logik ist bereits Unit-getestet, Visual-Regression-Snapshots wären das richtige Werkzeug für Style-Varianten |
| Testen der IdP-eigenen Login-Seite/Drittanbieter-SSO-UI | Kein Einfluss auf Kurzly-Code, hohe Flakiness, kein Qualitätsgewinn — nur Callback-Vertrag wird gegen einen Test-IdP geprüft |
| Echter Produktions-SMTP-Versand in E2E/CI | Bereits projektweiter Anti-Pattern-Grundsatz; Mailpit ist die festgelegte Lösung |
| Pixel-genaue Light/Dark-Fidelity-Prüfung via Playwright-Assertions | Playwright ist das falsche Werkzeug für Pixel-Fidelity (brüchige Screenshot-Diffs); gehört in einen dedizierten Visual-Review-Prozess |
| Analytics-Parsing-Edge-Cases (UA-/Referrer-Parsing, GeoIP-Grenzfälle) | Reine Datentransformationslogik ohne Browser-Interaktionskomponente — gehört in Unit-Tests der Parser |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 11 | Complete |
| INFRA-02 | Phase 11 | Complete |
| INFRA-03 | Phase 11 | Complete |
| INFRA-04 | Phase 11 | Complete |
| INFRA-05 | Phase 11 | Complete |
| INFRA-06 | Phase 11 | Complete |
| REDIRECT-E2E-01 | Phase 12 | Complete |
| REDIRECT-E2E-02 | Phase 12 | Complete |
| REDIRECT-E2E-03 | Phase 12 | Complete |
| REDIRECT-E2E-04 | Phase 12 | Complete |
| REDIRECT-E2E-05 | Phase 12 | Complete |
| AUTH-E2E-01 | Phase 13 | Complete |
| AUTH-E2E-02 | Phase 13 | Complete |
| AUTH-E2E-03 | Phase 13 | Complete |
| AUTH-E2E-04 | Phase 13 | Complete |
| AUTH-E2E-05 | Phase 13 | Pending |
| AUTH-E2E-06 | Phase 13 | Complete |
| AUTH-E2E-07 | Phase 13 | Complete |
| LINKS-E2E-01 | Phase 14 | Pending |
| LINKS-E2E-02 | Phase 14 | Pending |
| LINKS-E2E-03 | Phase 14 | Pending |
| QR-E2E-01 | Phase 15 | Pending |
| QR-E2E-02 | Phase 15 | Pending |
| QR-E2E-03 | Phase 15 | Pending |
| ANALYTICS-E2E-01 | Phase 16 | Pending |
| ANALYTICS-E2E-02 | Phase 16 | Pending |
| ANALYTICS-E2E-03 | Phase 16 | Pending |
| TEAM-E2E-01 | Phase 17 | Pending |
| TEAM-E2E-02 | Phase 17 | Pending |
| TEAM-E2E-03 | Phase 17 | Pending |
| AUTHZ-E2E-01 | Phase 17 | Pending |
| AUTHZ-E2E-02 | Phase 17 | Pending |

**Coverage:** 32/32 requirements mapped across Phases 11–17 — no orphans, no duplicates.

---
*Requirements for: Milestone v1.1 "E2E Test Coverage", Kurzly*
