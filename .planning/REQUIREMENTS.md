# Requirements: Kurzly

**Defined:** 2026-07-10
**Core Value:** Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking.

> **Scope-Entscheidung:** v1 = voller Funktionsumfang (alle 12 Anforderungen der Spec). Alle Requirements sind Hypothesen bis ausgeliefert & validiert.
> **TDD verpflichtend:** Jedes Requirement gilt erst als erfüllt, wenn es durch automatisierte Tests abgedeckt und grün ist (Unit + Integration; kritische Flows E2E). Sicherheits-/Korrektheits-kritische Requirements benötigen Negativ-/Canary-Tests (siehe Notizen).

## v1 Requirements

### Deployment & Betrieb

- [x] **INFRA-01**: Betreiber kann den gesamten Dienst (API, Web, PostgreSQL, Reverse-Proxy) via `docker-compose up` starten
- [x] **INFRA-02**: Betreiber konfiguriert die Instanz vollständig über Environment-Variablen (DB-URL, SMTP, Basis-Domain, Secrets)
- [x] **INFRA-03**: Daten (Postgres) überstehen Container-Neustarts über ein persistentes Volume

### Authentifizierung (better-auth)

- [ ] **AUTH-01**: Nutzer kann auf der Login-Seite per E-Mail-Eingabe einen Magic Link anfordern
- [ ] **AUTH-02**: Nutzer wird durch Klick auf einen gültigen, einmalig nutzbaren Magic Link (15 Min gültig) angemeldet
- [ ] **AUTH-03**: Nutzersitzung bleibt über Browser-Refresh hinweg bestehen
- [ ] **AUTH-04**: Nutzer kann sich von jeder Seite abmelden
- [ ] **AUTH-05**: Admin kann OIDC/SSO durch Eingabe von Issuer-URL, Client-ID und Client-Secret aktivieren
- [ ] **AUTH-06**: Nutzer kann sich bei aktivem SSO über den konfigurierten OIDC-Provider anmelden
- [ ] **AUTH-07**: Per SSO neu angelegte Nutzer erhalten automatisch die Rolle „Mitglied"

### Team & Rollen

- [ ] **TEAM-01**: Admin kann einen Nutzer per E-Mail einladen und dabei Rolle (Admin oder Mitglied) wählen (Magic Link wird versandt)
- [ ] **TEAM-02**: Eingeladener Nutzer erscheint mit Status „Ausstehend" bis zum ersten erfolgreichen Login, danach „Aktiv"
- [ ] **TEAM-03**: Admin kann einem Mitglied spezifische Domains zuweisen
- [ ] **TEAM-04**: Admin kann die Rolle eines Nutzers ändern; Wechsel zu Admin leert die Domain-Zuweisungen
- [ ] **TEAM-05**: Admin kann einen Nutzer entfernen
- [ ] **TEAM-06**: Mitglied sieht und bearbeitet ausschließlich die ihm zugewiesenen Domains — serverseitig bei JEDER Link-/QR-/Analytics-Operation autorisiert

### Domains

- [ ] **DOMAIN-01**: Admin kann eine eigene Domain/Subdomain registrieren; sie wird mit Status „DNS ausstehend" angelegt
- [ ] **DOMAIN-02**: Admin kann die DNS-Konfiguration (CNAME) einer Domain prüfen; bei Erfolg wechselt sie auf „Aktiv"
- [ ] **DOMAIN-03**: System stellt für verifizierte Domains automatisch TLS-Zertifikate aus (Let's Encrypt, on-demand, gated per verifiziertem Domain-Status)
- [ ] **DOMAIN-04**: Admin sieht pro Domain die DNS-Anleitung (CNAME-Ziel)

### Link-Verwaltung

- [ ] **LINK-01**: Nutzer kann einen Kurzlink durch Wahl von Domain + Ziel-URL erstellen (leerer Slug → automatisch generiert)
- [ ] **LINK-02**: Nutzer kann einen eigenen Slug für einen Kurzlink festlegen
- [ ] **LINK-03**: Nutzer kann die Kurzlink-Liste durchsuchen und nach Domain filtern
- [ ] **LINK-04**: Nutzer kann die vollständige URL eines Kurzlinks in die Zwischenablage kopieren
- [ ] **LINK-05**: Nutzer kann eine Link-Detailseite mit Attributen und Statistiken öffnen
- [ ] **LINK-06**: Nutzer kann die Einstellungen eines Links bearbeiten
- [ ] **LINK-07**: Nutzer kann einen Link löschen
- [ ] **LINK-08**: Nutzer kann Links per CSV-Bulk-Import anlegen (`ziel_url, slug, domain`) mit Live-Validierungsvorschau (N gültig · M übersprungen)

### Redirect-Engine (Kernwert)

- [ ] **REDIR-01**: Aufruf eines Kurzlinks leitet per HTTP 302 auf die Ziel-URL weiter
- [ ] **REDIR-02**: Redirect-Auflösung ist pro eigener Domain korrekt gescoped (Host-basiert)
- [ ] **REDIR-03**: Ein abgelaufener Link liefert HTTP 410 Gone mit der Ablauf-Seite (keine Weiterleitung)
- [ ] **REDIR-04**: Ein passwortgeschützter Link zeigt die Passwort-Seite; das Ziel wird erst nach serverseitig korrekt geprüftem Passwort ausgeliefert (gehasht gespeichert)
- [ ] **REDIR-05**: Social-/Bot-Crawler erhalten injizierte Custom-OG-Tags ohne Weiterleitung; geschützte/abgelaufene Ziele werden nie vor Prüfung preisgegeben

### QR-Codes

- [ ] **QR-01**: Nutzer kann einen statischen QR-Code zu einem Kurzlink erzeugen (PNG- und SVG-Export)
- [ ] **QR-02**: Nutzer kann einen dynamischen QR-Code mit eigener Kurz-URL (`/q/xxxx`) anlegen
- [ ] **QR-03**: Nutzer kann das Ziel eines dynamischen QR-Codes jederzeit auf einen anderen Link umstellen; der gedruckte Code bleibt gültig
- [ ] **QR-04**: Nutzer kann die Remapping-Historie eines dynamischen QR-Codes einsehen
- [ ] **QR-05**: Nutzer kann ein zentriertes Logo in den QR-Code einfügen (Fehlerkorrektur-Level H → bleibt scannbar)
- [ ] **QR-06**: Nutzer kann im QR-Studio Farbe wählen und runde Module umschalten
- [ ] **QR-07**: Nutzer sieht die Scan-Anzahl eines QR-Codes

### Link-Metadaten (UTM & OG)

- [ ] **META-01**: Nutzer kann UTM-Parameter (source/medium/campaign) bauen mit Live-Vorschau der finalen Ziel-URL
- [ ] **META-02**: Nutzer kann pro Link Custom-OG-Tags (Titel, Beschreibung, Bild-URL) setzen mit Social-Card-Vorschau

### Tracking & Analytics (intern, datenschutzfreundlich)

- [ ] **TRACK-01**: Nutzer kann internes Klick-Tracking pro Link umschalten (Default an)
- [ ] **TRACK-02**: Bei Tracking „aus" werden für diesen Link keinerlei Klickdaten gespeichert (null Zeilen geschrieben)
- [ ] **TRACK-03**: Ein getrackter Link erfasst Klickanzahl, Referrer und Länder ohne Drittanbieter
- [ ] **TRACK-04**: Nutzer sieht pro Link Analytics (Gesamt, 30-Tage-Zeitreihe, Top-Referrer, Länder)
- [ ] **TRACK-05**: Nutzer sieht eine globale Analytics-Übersicht (Klicks, Unique Visitors, aktive Links, QR-Scans, Top-Links, Referrer)

### Dashboard-UI & öffentliche Seiten

- [ ] **UI-01**: Nutzer navigiert einen persistenten App-Shell (212px Sidebar + scrollbarer Content) gemäß Hi-Fi-Prototyp
- [ ] **UI-02**: Nutzer kann zwischen Light- und Dark-Theme umschalten
- [ ] **UI-03**: Alle Dashboard-Screens entsprechen pixelgenau den Design-Tokens des Prototyps (Geist-Fonts, Lime-Akzent `#d7ff01`, Spacing, Radii)
- [ ] **UI-04**: Besucher sieht eine öffentliche Passwort-Seite (außerhalb des Dashboards) für geschützte Links
- [ ] **UI-05**: Besucher sieht eine öffentliche Ablauf-Seite für abgelaufene Links
- [ ] **UI-06**: Nutzer erhält Toast-Bestätigungen für Aktionen (Erstellen, Kopieren, Import, Remap etc.)

## v2 Requirements

Nicht in v1-Scope; als spätere Skalierungs-/Erweiterungsschritte notiert (aus Research abgeleitet, keine unmittelbaren Nutzeranforderungen).

### Skalierung & Performance

- **SCALE-01**: Rollup-/Aggregations-Tabellen für Analytics statt On-Read-Aggregation (bei hohem Klickvolumen)
- **SCALE-02**: Redis-/verteilter Cache & Rate-Limiting für Multi-Instanz-Betrieb (v1: In-Process-LRU genügt)
- **SCALE-03**: PgBouncer-Connection-Pooling für den Redirect-Hot-Path bei hoher Last

## Out of Scope

Explizit ausgeschlossen, um Scope-Creep zu verhindern.

| Feature | Reason |
|---------|--------|
| E-Mail-/Passwort-Login | Spec schreibt ausschließlich Magic Link vor; Passwort-Flow bewusst nicht implementiert |
| Drittanbieter-/externes Analytics (GA o.ä.) | Kernwert ist datenschutzfreundliches internes Tracking |
| Öffentliche Self-Service-Registrierung | Nutzer entstehen nur per Team-Einladung |
| Rollen jenseits Admin/Mitglied | Spec definiert genau zwei Rollen |
| Bezahl-/Billing-Funktionen | Reines self-hosted OSS-Tool, keine SaaS-Monetarisierung |
| Geo-/Device-Targeting, A/B-Tests, Conditional Redirects | Anti-Feature (Research) — nicht angefragt, inkompatibel mit aktuellem Design |
| Browser-Fingerprinting-Analytics | Anti-Feature — widerspricht Datenschutz-Kernwert |
| Auto-Fetch von OG-Daten aus der Ziel-URL | v1: OG-Tags nur nutzer-eingegeben (vermeidet SSRF-Hardening-Aufwand); als künftiges Risiko dokumentiert |

## Traceability

Jedes v1-Requirement → genau eine Phase (siehe ROADMAP.md für vollständige Phasenstruktur).

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| UI-01 | Phase 2 | Pending |
| UI-02 | Phase 2 | Pending |
| UI-03 | Phase 2 | Pending |
| DOMAIN-01 | Phase 3 | Pending |
| DOMAIN-02 | Phase 3 | Pending |
| DOMAIN-03 | Phase 3 | Pending |
| DOMAIN-04 | Phase 3 | Pending |
| LINK-01 | Phase 4 | Pending |
| LINK-02 | Phase 4 | Pending |
| LINK-03 | Phase 4 | Pending |
| LINK-04 | Phase 4 | Pending |
| LINK-05 | Phase 4 | Pending |
| LINK-06 | Phase 4 | Pending |
| LINK-07 | Phase 4 | Pending |
| LINK-08 | Phase 4 | Pending |
| UI-06 | Phase 4 | Pending |
| REDIR-01 | Phase 5 | Pending |
| REDIR-02 | Phase 5 | Pending |
| REDIR-03 | Phase 5 | Pending |
| REDIR-04 | Phase 5 | Pending |
| REDIR-05 | Phase 5 | Pending |
| UI-04 | Phase 5 | Pending |
| UI-05 | Phase 5 | Pending |
| TRACK-01 | Phase 6 | Pending |
| TRACK-02 | Phase 6 | Pending |
| TRACK-03 | Phase 6 | Pending |
| TRACK-04 | Phase 6 | Pending |
| TRACK-05 | Phase 6 | Pending |
| QR-01 | Phase 7 | Pending |
| QR-02 | Phase 7 | Pending |
| QR-03 | Phase 7 | Pending |
| QR-04 | Phase 7 | Pending |
| QR-05 | Phase 7 | Pending |
| QR-06 | Phase 7 | Pending |
| QR-07 | Phase 7 | Pending |
| META-01 | Phase 8 | Pending |
| META-02 | Phase 8 | Pending |
| TEAM-01 | Phase 9 | Pending |
| TEAM-02 | Phase 9 | Pending |
| TEAM-03 | Phase 9 | Pending |
| TEAM-04 | Phase 9 | Pending |
| TEAM-05 | Phase 9 | Pending |
| TEAM-06 | Phase 9 | Pending |
| AUTH-05 | Phase 10 | Pending |
| AUTH-06 | Phase 10 | Pending |
| AUTH-07 | Phase 10 | Pending |

**Coverage:**

- v1 requirements: 53 total (corrected from an earlier miscount of 47 — a direct recount of every `REQ-ID` bullet across all 10 categories confirms 53 distinct v1 requirement IDs)
- Mapped to phases: 53/53
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-10*
*Last updated: 2026-07-10 after roadmap creation (traceability populated, requirement-count corrected 47→53)*
