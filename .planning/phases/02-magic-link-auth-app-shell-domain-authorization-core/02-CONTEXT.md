# Phase 2: Magic-Link Auth, App Shell & Domain Authorization Core - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Nutzer melden sich sicher per Magic Link an und landen in einer pixelgenauen, themefähigen Dashboard-Shell. Der server-seitige Autorisierungskern (`requireDomainAccess` / `scopedDomainIds`) wird hier gebaut und unit-getestet — bevor irgendeine Links/QR/Analytics/Team-Route ihn nutzt.

**Requirements:** AUTH-01 (Magic Link anfordern), AUTH-02 (Login via gültigem, einmaligem, 15-Min-Link), AUTH-03 (Session übersteht Refresh), AUTH-04 (Logout von jeder Seite), UI-01 (persistenter App-Shell 212px Sidebar), UI-02 (Light/Dark-Theme), UI-03 (pixelgenaue Design-Tokens).

**In scope:** better-auth `magicLink()`-Login mit SMTP-Zustellung; Session-Handling; App-Shell (Sidebar + Content) gemäß Hi-Fi-Prototyp mit Theme-Toggle; der domain-gescopte Autorisierungskern (Rollen-Enum + Membership-Modell + `requireDomainAccess`/`scopedDomainIds`-Helfer, unit-getestet).

**Out of scope (spätere Phasen):** Domain-Registrierung/DNS/TLS-Lifecycle (Phase 3 — Phase 2 legt nur das minimale Domain-/Membership-Schema an, gegen das der Autorisierungshelfer baut+testet); Links/QR/Analytics/Team-Feature-Screens (eigene Phasen, hier nur Platzhalter); vollständiges Team-Management-UI; Generic-OIDC/SSO.
</domain>

<decisions>
## Implementation Decisions

### Signup- & Admin-Policy
- **D-01:** Kein offener Public-Signup. Der **erste Admin** entsteht via `INITIAL_ADMIN_EMAIL` (ENV): beim Boot wird dieser Nutzer als Owner/Admin geseedet bzw. beim ersten Login erkannt. Danach ist der Zugang **invite-only** — ein Admin fügt erlaubte E-Mail-Adressen in-app hinzu; nur diese können sich anschließend per Magic Link anmelden. Eine Magic-Link-Anforderung für eine nicht-erlaubte/unbekannte E-Mail wird **neutral** behandelt (gleiche „Link gesendet, falls Konto existiert"-Antwort — keine Account-Enumeration).

### Autorisierungsmodell (Kern dieser Phase)
- **D-02:** Rollenmodell **owner / admin / member**, domain-gescopte Mitgliedschaft (Hierarchie owner > admin > member). Server-seitige Helfer:
  - `requireDomainAccess(userId, domainId, minRole)` — wirft/verweigert, wenn der Nutzer nicht Mitglied der Domain mit mindestens `minRole` ist.
  - `scopedDomainIds(userId)` — liefert die Menge der Domain-IDs, auf die der Nutzer Zugriff hat (für Listen-/Query-Scoping).
  Beide werden hier **gebaut und unit-getestet** (gegen echtes Postgres via testcontainers-Harness aus Phase 1), damit alle späteren Feature-Routen sie als einzigen Autorisierungspfad nutzen.
- **D-02b:** Phase 2 führt das **minimale Schema** ein, das der Helfer braucht: `User`, better-auth `Session`/`Account`/Verification-Tabellen, eine `DomainMembership` (user ↔ domain ↔ role) und eine minimale `Domain`-Referenz. Der volle Domain-Lifecycle (Registrierung, DNS-Verifizierung, TLS) bleibt Phase 3.

### App-Shell (UI)
- **D-03:** **Volle Sidebar-Nav** gemäß Hi-Fi-Prototyp (212px, scrollbarer Content). Alle finalen Nav-Items sind sichtbar; noch nicht gebaute Feature-Screens sind sichtbare **„Coming soon"-Platzhalter** (die Shell fühlt sich vollständig an). Landing nach Login = Dashboard/Übersicht.
- **D-04:** **Pixelgenaue Design-Tokens** aus dem Prototyp (Geist-Typografie, Lime-Akzent `#d7ff01`, Spacing, Radii) — UI-03. **Light/Dark-Theme-Toggle** (UI-02); Theme-Präferenz clientseitig in `localStorage` persistiert.

### Magic-Link-Fehler-UX
- **D-05:** Abgelaufener / bereits benutzter / ungültiger Link → **eigene Statusseite** mit klarer Meldung und Button **„Neuen Link anfordern"**. Kein Ziel-/Account-Leak vor Prüfung.

### Session & Logout
- **D-06:** better-auth-Session-Cookie (httpOnly), übersteht Browser-Refresh (AUTH-03). Logout-Aktion im App-Shell-User-Menü, von **jeder** Seite erreichbar (AUTH-04).

### Security-Baseline (Phase-1-Code-Review-Deferrals ziehen hier ein)
- **D-07:** Phase 2 führt **`@fastify/rate-limit`** (schützt den Magic-Link-Request- und Auth-Endpoint gegen E-Mail-Bombing/Brute-Force) und **`@fastify/helmet`** (Security-Header-Baseline) ein — die beiden bewusst zurückgestellten Findings WR-02/WR-04 aus dem Phase-1-Code-Review. **Erfordert eine neue Supply-Chain-Freigabe** für die zusätzlichen Pakete (Threat T-01-SC-Gate).

### Claude's Discretion
- Exakte better-auth-Konfiguration (`magicLink().sendMagicLink` → nodemailer-Transport aus Phase-1-SMTP-ENV; Prisma-Adapter mit **demselben** generierten Client aus `apps/api/src/generated/prisma`; `npx @better-auth/cli generate` für die Auth-Tabellen), Session-Cookie-Settings, Vue-Router-Navigation-Guards, Pinia-Stores (`authSession`, `theme`), Platzierung der Helfer (server-seitig in `apps/api`, DTOs in `packages/shared`) und die genaue Membership-Query — überlässt der Nutzer dem Researcher/Planner auf Basis der CLAUDE.md-Stack-Vorgaben.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projekt- & Anforderungskontext
- `.planning/PROJECT.md` — Constraints (Auth-Stack, Security, TDD), Key Decisions.
- `.planning/REQUIREMENTS.md` — AUTH-01…04, UI-01…03 Definitionen + Traceability.
- `.planning/ROADMAP.md` §Phase 2 — Goal & Success Criteria.

### Tech-Stack (verbindlich)
- `.claude/CLAUDE.md` — better-auth `magicLink()` (einziger Login) + optional `sso`/`genericOAuth`, `prismaAdapter` (gleicher generierter Client wie Phase 1), nodemailer-SMTP-ENV, Vue 3 `<script setup>` + Pinia ^3 + Vue Router ^4, `@fastify/rate-limit`/`@fastify/helmet` Härtung.

### Design-Handoff (maßgeblich für UI-01/02/03 — pixelgenau)
- `design_handoff_url_shortener/README.md` — vollständige Spec.
- `design_handoff_url_shortener/Kurzly Prototyp.dc.html` — maßgeblicher Hi-Fi-Prototyp (Shell, Nav, Tokens, Themes).
- `design_handoff_url_shortener/URL Shortener Wireframes.dc.html` — Wireframes.

### Phase-1-Artefakte (wiederverwenden/erweitern)
- `apps/api/prisma/schema.prisma` — um `User`/`Session`/`Account`/`DomainMembership`/minimale `Domain` erweitern; via `prisma migrate dev` neue Migration.
- `apps/api/src/generated/prisma` — better-auth-Prisma-Adapter MUSS denselben Client importieren.
- `apps/api/src/env.ts` — um `INITIAL_ADMIN_EMAIL` erweitern (`BETTER_AUTH_SECRET`, `SMTP_*`, `BASE_URL` existieren bereits).
- `apps/api/src/app.ts` — better-auth-Handler + Auth-Routen registrieren (vor SPA-Catch-all, wie Phase-1-Route-Order).
- `apps/api/test/globalSetup.ts` — testcontainers-Harness für Unit-/Integrationstests des Autorisierungskerns.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (aus Phase 1)
- `buildApp()`-Factory (`apps/api/src/app.ts`) mit korrekter Route-Reihenfolge (API/Auth vor SPA-Fallback) — better-auth-Handler hier einhängen.
- Fail-fast ENV-Validierung (`env.ts`) — `INITIAL_ADMIN_EMAIL` als Pflichtvariable ergänzen; better-auth-Secret + SMTP schon vorhanden.
- Prisma-Client + `@prisma/adapter-pg` (`db.ts`) — better-auth teilt sich diesen Client; Schema erweitern statt neu.
- Real-Postgres-TDD-Harness (`globalSetup.ts` + Per-Test-Rollback) — ideal für die verpflichtenden Unit-Tests von `requireDomainAccess`/`scopedDomainIds`.
- Vue-App-Shell-Scaffold (`apps/web`), typisierter API-Client (`apps/web/src/api.ts`), geteilte DTOs (`packages/shared`).

### Established Patterns
- Single-Origin-Deployment (D-01 aus Phase 1): Auth-Cookies same-origin, kein CORS in Prod.
- Prisma-7-Eigenheit: `prisma.config.ts` (datasource url) + Adapter-Client — better-auth-Tabellen über denselben Weg.

### Integration Points
- `requireDomainAccess`/`scopedDomainIds` sind der **einzige** Autorisierungspfad, den Phasen 3–7 (Domains, Links, QR, Analytics, Team) nutzen — Signatur hier bewusst stabil halten.
</code_context>

<specifics>
## Specific Ideas

- Anmelde-Erlebnis-Anker: E-Mail eingeben → „Link gesendet (falls berechtigt)" → Klick → im Dashboard. Nicht-berechtigte E-Mails bekommen dieselbe neutrale Antwort (kein Enumeration-Leak).
- Der Autorisierungskern wird gebaut, *bevor* es Domains/Links gibt — daher minimales Domain-/Membership-Schema + Unit-Tests gegen echtes Postgres, nicht gegen Mocks.
- App-Shell mit vollständiger Nav + „Coming soon"-Platzhaltern gibt sofort das Gefühl des fertigen Produkts und macht spätere Feature-Phasen zu reinen Screen-Einsätzen.
</specifics>

<deferred>
## Deferred Ideas

- **Generic-OIDC/SSO** — nicht in Phase 2 (Roadmap listet nur Magic-Link AUTH-01…04). Später als optionaler `sso`-Plugin-Toggle mit Issuer-URL/Client-ID/Secret-Admin-UI.
- **Vollständiges Team-Management-UI** (Einladungen verwalten, Rollen im UI zuweisen, Mitglieder listen) — eigene spätere Phase. Phase 2 baut nur den Autorisierungskern + minimalen Admin-Invite-Pfad (erlaubte E-Mail hinzufügen).
- **Voller Domain-Lifecycle** (Registrierung, DNS-Verifizierung, On-Demand-TLS) — Phase 3.
</deferred>

---

*Phase: 2-magic-link-auth-app-shell-domain-authorization-core*
*Context gathered: 2026-07-11*
