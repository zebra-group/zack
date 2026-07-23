# Kurzly

## What This Is

Kurzly ist ein self-hosted, quelloffener URL-Shortener (in der Klasse von bit.ly / dub.co) für Teams, die ihre Kurzlinks auf eigener Infrastruktur betreiben wollen. Betrieben wird der gesamte Dienst als Docker/Compose-Setup; das Dashboard verwaltet Kurzlinks auf beliebigen eigenen Domains, dynamische und statische QR-Codes, internes datenschutzfreundliches Klick-Tracking sowie ein rollenbasiertes Team-Management. Zielnutzer sind Agenturen, Firmen und technisch versierte Betreiber, die Datenhoheit und eigene Domains ohne Drittanbieter-Tracking wollen.

## Core Value

Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking. Wenn alles andere ausfällt, muss der Redirect-Handler (Domain → Slug → Ziel-URL) korrekt und schnell funktionieren.

## Current State

**Shipped: v1.0 MVP (2026-07-23)** — full v1 feature scope, all 53 requirements delivered and verified across 10 phases. ~37k LOC TypeScript/Vue across a pnpm monorepo (apps/api Fastify + apps/web Vue 3 + packages/shared). Test suite: 540 API tests (44 files, real-Postgres testcontainers harness) + 256 web tests (21 files), workspace `tsc --noEmit` clean. Docker/Compose-hostable, ENV-configured end to end.

## Requirements

### Validated

- ✓ Docker-hostbar (on-premise) als Image/Compose-Setup — v1.0
- ✓ Link-Kürzung mit eigenen Domains/Subdomains (`example.com/kurz` → Redirect) — v1.0
- ✓ QR-Codes mit zentriertem Logo (PNG-/SVG-Export, EC-Level H bei Logo-Overlay, decode-round-trip getestet) — v1.0
- ✓ Dynamische QR-Codes mit eigener Kurz-URL (`/q/xxxx`), Ziel umstellbar, Remapping-Historie — v1.0
- ✓ UTM-Parameter-Builder (source/medium/campaign) mit Live-Vorschau — v1.0
- ✓ Custom OG-Tags pro Link (Titel, Beschreibung, Bild-URL) mit Social-Card-Vorschau, SSRF-sicher (Server holt das Ziel nie) — v1.0
- ✓ Passwortschutz pro Link (bcrypt, Ziel erst nach Prüfung ausgeliefert, no-leak) — v1.0
- ✓ Expiration Date pro Link (abgelaufen → HTTP 410) — v1.0
- ✓ Internes Klick-Tracking pro Link, an-/ausschaltbar (Klicks + Referrer + Länder, true zero-rows wenn aus, kein Drittanbieter) — v1.0
- ✓ Benutzerverwaltung mit domain-scoped Rollen, serverseitig bei JEDER Operation autorisiert (bewiesen durch Denial-Suite) — v1.0
- ✓ Magic-Link-Login (better-auth, invite-only, kein Passwort-Login) — v1.0
- ✓ OIDC/SSO-Integration (optional, ENV-konfiguriert; SSO-Neuanmeldungen → least-privilege „Mitglied") — v1.0
- ✓ Dashboard-UI pixelgenau nach Hi-Fi-Prototyp, Light + Dark — v1.0

### Active

(Nächster Milestone noch nicht definiert — `/gsd-new-milestone` startet die Anforderungsdefinition. Kandidaten aus v1.0-Tech-Debt: QR-Löschpfad, DB-Unique-Index für statische QRs, `trackingEnabled`-Edit-Fix.)

### Out of Scope

- E-Mail-/Passwort-Login — Spec schreibt ausschließlich Magic Link vor; Passwort-Flow bewusst nicht implementieren.
- Drittanbieter-/externes Analytics (GA o.ä.) — Kernwert ist datenschutzfreundliches internes Tracking.
- Öffentliche Self-Service-Registrierung — Nutzer entstehen nur per Team-Einladung (Magic Link).
- Rollen jenseits von Admin/Mitglied — Spec definiert genau zwei Rollen.
- Bezahl-/Billing-Funktionen — reines self-hosted OSS-Tool, keine SaaS-Monetarisierung.

## Context

- **Design-Handoff vorhanden:** `design_handoff_url_shortener/` enthält High-Fidelity-HTML-Prototyp (`Kurzly Prototyp.dc.html`, maßgeblich), Wireframes (`URL Shortener Wireframes.dc.html`) und die vollständige Spec (`README.md`). Diese sind Referenzen, **kein Produktionscode** — im Ziel-Stack (Vue 3) mit dessen etablierten Patterns nachzubauen.
- **Finales Layout:** Kombination aus Wireframe 1a (Sidebar 212px) + 1b (Domain-Tabs/dichte Tabelle).
- **Design-Tokens final:** Geist / Geist Mono Typografie, Lime-Akzent `#d7ff01` (Text auf Akzent immer `#1b1b18`), Light/Dark-Farbsets vollständig definiert, flache Karten mit Border (12px Radius), nüchterne Animationen (nur 150ms Switch-Transitions).
- **Beispieldaten** (acme.io etc.) sind Platzhalter.
- **Autorisierung serverseitig:** Mitglieder-Rollen müssen bei JEDER Link-/QR-/Analytics-Operation gegen `user.domains[]` autorisiert werden — nicht nur UI-seitig ausblenden.

## Constraints

- **Tech stack (Frontend)**: Vue 3 — vom Projektinhaber vorgegeben.
- **Tech stack (Backend)**: Node.js mit Fastify — vom Projektinhaber vorgegeben.
- **Tech stack (DB)**: PostgreSQL mit Prisma — für Multi-User/Team-Setups robust und skalierbar.
- **Tech stack (Auth)**: better-auth mit `magicLink()`-Plugin (Standard) + Generic-OIDC (optional) — Spec-vorgegeben.
- **E-Mail**: konfigurierbarer SMTP-Versand per ENV (nodemailer), provider-neutral — für Magic-Link-Zustellung.
- **Deployment**: Alles Docker-/Compose-hostbar, on-premise betreibbar — harte Anforderung.
- **UI-Treue**: High-Fidelity — Farben, Typografie, Abstände, Interaktionen pixelgenau nach Prototyp.
- **Security**: Passwörter gehasht; geschützte/abgelaufene Ziele nie vor Prüfung im HTML einbetten; kein OG-Preview des Ziels vor Entsperrung; TLS via Let's Encrypt nach DNS-Verifizierung.
- **Test-Driven Development (verpflichtend)**: Jede Phase folgt TDD — Tests zuerst, dann Implementierung. Alles muss automatisiert getestet werden (Unit + Integration; kritische Flows E2E). Ziel: sauberer, lesbarer, wartbarer Code. Kein Feature gilt als fertig ohne grüne automatisierte Tests. CI führt die gesamte Suite bei jeder Änderung aus.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1 = voller Funktionsumfang (alle Anforderungen) | Spec ist vollständig und Feature-komplett gedacht; kein MVP-Beschnitt gewünscht | ✓ Good — alle 53 Anforderungen in v1.0 ausgeliefert |
| PostgreSQL + Prisma als Persistenz | Robust für Multi-User/Team, klarer Migrations-/Typ-Workflow | ✓ Good — Prisma 7 + adapter-pg, saubere additive Migrationen durchgehend |
| SMTP (ENV-konfigurierbar) für Magic-Link-Mails | Maximal self-host-freundlich, provider-neutral | ✓ Good |
| Produktname „Kurzly" beibehalten | Arbeitstitel akzeptiert; Brandname/Akzent konfigurierbar | ✓ Good |
| better-auth als Auth-Layer (Magic Link Standard, OIDC optional) | Spec-vorgegeben | ✓ Good — magicLink() + genericOAuth (1.6.23 hat kein sso-Plugin) |
| Test-Driven Development verpflichtend, volle Testautomatisierung | Vom Nutzer explizit gefordert — Regressionsschutz | ✓ Good — 796 Tests, real-Postgres-Harness, RED→GREEN durchgehend |
| Domain-scoped Autorisierung in `requireDomainAccess`/`scopedDomainIds` zentralisiert (Phase 2), account-admin Bypass darin (Phase 9) | Jeder Link/QR/Analytics-Callsite erbt die Durchsetzung ohne Route-Edits; Denial-Suite beweist sie | ✓ Good |
| Per-file cloned-DB Test-Isolation statt shared-DB BEGIN/ROLLBACK | Postgres kennt keine verschachtelten Transaktionen — interaktive `$transaction` committete den Test-Wrapper mit und leakte Zeilen | ✓ Good — in Phase 7 entdeckt & behoben |
| OIDC ENV-konfiguriert, Admin-Karte read-only Status (D-10-02) | Konsistent mit ENV-everywhere/self-hosted; better-auth konfiguriert statisch beim Boot; Secret bleibt aus der App-DB | ⚠️ Revisit — weicht von wörtlicher Prototyp-Lesart ab; ggf. Folge-Phase für Dashboard-Eingabe |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-23 after v1.0 milestone*
