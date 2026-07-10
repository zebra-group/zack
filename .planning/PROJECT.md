# Kurzly

## What This Is

Kurzly ist ein self-hosted, quelloffener URL-Shortener (in der Klasse von bit.ly / dub.co) für Teams, die ihre Kurzlinks auf eigener Infrastruktur betreiben wollen. Betrieben wird der gesamte Dienst als Docker/Compose-Setup; das Dashboard verwaltet Kurzlinks auf beliebigen eigenen Domains, dynamische und statische QR-Codes, internes datenschutzfreundliches Klick-Tracking sowie ein rollenbasiertes Team-Management. Zielnutzer sind Agenturen, Firmen und technisch versierte Betreiber, die Datenhoheit und eigene Domains ohne Drittanbieter-Tracking wollen.

## Core Value

Kurzlinks auf eigenen Domains zuverlässig kürzen und weiterleiten — self-hosted, ohne Drittanbieter-Tracking. Wenn alles andere ausfällt, muss der Redirect-Handler (Domain → Slug → Ziel-URL) korrekt und schnell funktionieren.

## Requirements

### Validated

(Noch keine — self-hosted MVP muss erst ausgeliefert werden, um zu validieren)

### Active

<!-- v1 = voller Funktionsumfang laut Spec (alle 12 Anforderungen des Projektinhabers) -->

- [ ] Docker-hostbar (on-premise) als Image/Compose-Setup
- [ ] Link-Kürzung mit eigenen Domains/Subdomains (`example.com/kurz` → Redirect auf Ziel-URL)
- [ ] QR-Codes mit eigenem Logo in der Mitte (PNG- und SVG-Export, Fehlerkorrektur-Level H bei Logo-Overlay)
- [ ] Dynamische QR-Codes mit eigener Kurz-URL (`/q/x7f2`), Ziel nachträglich umstellbar, Remapping-Historie
- [ ] UTM-Parameter-Builder (source/medium/campaign) mit Live-Vorschau der finalen Ziel-URL
- [ ] Custom OG-Tags pro Link (Titel, Beschreibung, Bild-URL) mit Social-Card-Vorschau
- [ ] Passwortschutz pro Link (optional, serverseitig gehasht, Ziel erst nach Prüfung ausgeliefert)
- [ ] Expiration Date pro Link (optional, abgelaufen → HTTP 410 Gone)
- [ ] Internes Klick-Tracking pro Link, an-/ausschaltbar (Klickanzahl + Referrer + Länder, kein Drittanbieter)
- [ ] Benutzerverwaltung mit domainspezifischen Rollen (Admin = alles, Mitglied = nur zugewiesene Domains)
- [ ] Authentifizierung via better-auth mit Magic Link als Standard-Login (kein Passwort-Login)
- [ ] OIDC / SSO-Integration (optional aktivierbar; SSO-Neuanmeldungen → Rolle „Mitglied")
- [ ] Dashboard-UI (12 Screens) pixelgenau nach Hi-Fi-Prototyp (`Kurzly Prototyp.dc.html`), Light + Dark

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

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1 = voller Funktionsumfang (alle 12 Anforderungen) | Spec ist vollständig und Feature-komplett gedacht; kein MVP-Beschnitt gewünscht | — Pending |
| PostgreSQL + Prisma als Persistenz | Robust für Multi-User/Team, klarer Migrations-/Typ-Workflow; Spec ließ DB offen | — Pending |
| SMTP (ENV-konfigurierbar) für Magic-Link-Mails | Maximal self-host-freundlich, provider-neutral | — Pending |
| Produktname „Kurzly" beibehalten | Arbeitstitel akzeptiert; Brandname/Akzent bleiben konfigurierbar (Prototyp-Props) | — Pending |
| better-auth als Auth-Layer (Magic Link Standard, OIDC optional) | Spec-vorgegeben | — Pending |

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
*Last updated: 2026-07-10 after initialization*
