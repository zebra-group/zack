# Phase 1: Test Infrastructure, Monorepo & Deployment Scaffolding - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Betreiber können den kompletten Kurzly-Stack via Docker Compose hochziehen, ihn vollständig über Environment-Variablen konfigurieren und sich darauf verlassen, dass Daten Neustarts überstehen — während das Team eine schnelle Real-Postgres-TDD-Harness (Vitest + testcontainers + Mailpit) besitzt, bevor Feature-Arbeit beginnt.

**Requirements:** INFRA-01 (Docker-Compose-hostbar), INFRA-02 (vollständig ENV-konfiguriert), INFRA-03 (persistentes Postgres-Volume).

**In scope:** pnpm-Monorepo-Scaffolding (`apps/web`, `apps/api`, `packages/shared`), Docker-Compose-Setup (app + db), ENV-Konfiguration mit Validierung, persistentes DB-Volume, TDD-Harness (Vitest + testcontainers + Mailpit), CI-Ausführung der Suite.

**Out of scope (spätere Phasen):** Auth/Magic-Link & User-Modell (Phase 2), Reverse-Proxy/TLS als Produktcode (Betreiber-Sache, siehe Deferred), jede Feature-Fachlichkeit.
</domain>

<decisions>
## Implementation Decisions

### Deployment-Topologie
- **D-01:** Single-Image-Deployment. Fastify serviert das gebaute Vue-`dist/` via `@fastify/static` und beherbergt sowohl `/api/*`, den Redirect-Handler als auch die statische SPA in **einem** `app`-Container. Gleiche Origin → in Produktion kein CORS nötig (`@fastify/cors` nur dev-only, per `NODE_ENV` gated).
- **D-02:** Produktions-Compose besteht aus zwei Services: `app` und `db` (`postgres:18-alpine`). Kein separater web-Container.

### Reverse-Proxy & TLS
- **D-03:** Kurzly verdrahtet **keinen** bestimmten Reverse-Proxy fest. Das mitgelieferte `docker-compose.yml` exponiert nur den App-Port (z. B. `3000`); TLS/Reverse-Proxy ist Betreiber-Verantwortung.
- **D-04:** Stattdessen wird der Proxy **dokumentiert** — eine `docs/deployment/reverse-proxy.md` (o. ä.) mit konkreten Beispielen: Caddyfile, nginx-Config, Traefik-Labels, certbot-Hinweis. Der Betreiber wählt selbst.

### DB-Migration beim Start
- **D-05:** Prisma-Migrationen werden **automatisch beim App-Start** angewendet: Der `app`-Container-Entrypoint führt `prisma migrate deploy` aus, bevor der Server startet. `docker-compose up` erfordert keine manuellen Migrationsschritte (erfüllt INFRA-01 „keine manuellen Schritte").

### ENV-Konfiguration
- **D-06:** Fail-fast Konfiguration. Beim Boot wird die ENV gegen ein Schema (Zod oder Typebox) validiert; fehlende Pflicht-Variablen oder ungültige Werte führen zu sofortigem Abbruch (`exit 1`) mit klarer Fehlermeldung — statt kryptischem Spät-Crash. Per Unit-Test abgedeckt.
- **D-07:** Eine `.env.example` listet **alle** Variablen mit erklärenden Kommentaren (DB-URL, SMTP-Zugangsdaten, Base-Domain, Secrets). Nichts ist im Image hardcodiert (erfüllt INFRA-02).

### Persistenz
- **D-08:** Postgres-Daten liegen auf einem **named volume**, sodass sie einen vollen Stop/Restart/Recreate-Zyklus überstehen (erfüllt INFRA-03). Als Canary-/Erfolgstest verifizieren, dass Daten nach `down`/`up` (ohne `-v`) erhalten bleiben.

### Test-Harness
- **D-09:** Integrationstests nutzen eine **Hybrid-Isolationsstrategie**: ein Postgres-Container pro Vitest-Worker, einmal geseedet, jeder Test läuft in einer Transaktion, die zurückgerollt wird (schnell für die Masse). Echte Multi-Container-Isolation nur für Migrations-/Schema-Tests (frischer Container).
- **D-10:** Ein separates `docker-compose.dev.yml` bringt Mailpit als SMTP-Catcher (nur dev/CI, **nie** im Produktions-Compose). Testcontainers spinnt Postgres ephemeral pro Testlauf hoch.
- **D-11:** CI führt die gesamte Suite bei jeder Änderung aus (TDD-Mandat aus PROJECT.md/CLAUDE.md).

### Claude's Discretion
- Konkrete Ausgestaltung von Healthchecks, `depends_on`/Wartelogik zwischen `app` und `db`, Multi-Stage-Dockerfile-Struktur, `pnpm`-Workspace-Details und die exakte testcontainers-Verdrahtung (globalSetup `provide`/`inject`) überlässt der Nutzer dem Planner/Researcher auf Basis der Tech-Stack-Empfehlung in CLAUDE.md.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projekt- & Anforderungskontext
- `.planning/PROJECT.md` — Constraints (Tech-Stack, Deployment, TDD), Key Decisions, Out-of-Scope.
- `.planning/REQUIREMENTS.md` — INFRA-01/02/03 Definitionen und Traceability.
- `.planning/ROADMAP.md` §Phase 1 — Goal & Success Criteria (Docker-Compose-Stack, ENV-Config, persistentes Volume, TDD-Harness).

### Tech-Stack (verbindlich vorgeprägt)
- `.claude/CLAUDE.md` — Recommended Stack & Version-Matrix: Node 24, Fastify ^5.10, Postgres 18-alpine, Prisma ^7 (mit explizitem `output`-Pfad, z. B. `src/generated/prisma`), pnpm-Workspace-Layout (`apps/web`, `apps/api`, `packages/shared`), Vitest ^4 + `@testcontainers/postgresql` + Mailpit, `@fastify/static`/`@fastify/cors` Deployment-Patterns.

### Design-Handoff (Referenz, kein Produktionscode — v. a. für spätere UI-Phasen)
- `design_handoff_url_shortener/README.md` — vollständige Spec.
- `design_handoff_url_shortener/Kurzly Prototyp.dc.html` — maßgeblicher Hi-Fi-Prototyp.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Noch keine — Greenfield. Diese Phase legt das Monorepo-Gerüst erst an.

### Established Patterns
- CLAUDE.md diktiert Prisma-7-Eigenheit: `generator client` braucht expliziten `output`-Pfad; better-auth (Phase 2) muss später denselben generierten Client importieren — Pfadwahl bereits hier beim Scaffolding fixieren.
- Single-Origin-Deployment (D-01) bestimmt, dass CORS in Produktion entfällt und der Redirect-Handler im selben Prozess wie API + SPA lebt.

### Integration Points
- `packages/shared` als Ort für gemeinsame DTOs (Link/QR/Domain), von `apps/web` und `apps/api` konsumiert — muss vor Feature-Phasen buildbar sein (vgl. globale „rebuild shared package"-Instruktion).

</code_context>

<specifics>
## Specific Ideas

- Betreiber-Erlebnis-Anker: „`docker-compose up` und es läuft" — keine manuellen Schritte außer ENV setzen. Migration (D-05), Fail-fast-Config (D-06) und `.env.example` (D-07) dienen genau diesem Ziel.
- Reverse-Proxy bewusst als Doku-mit-Beispielen statt Core-Feature — passend zur self-hosted-OSS-Philosophie (Betreiber-Datenhoheit, eigene Infrastruktur).

</specifics>

<deferred>
## Deferred Ideas

- **Reverse-Proxy/TLS als Produktcode → Phase 3 neu bewerten.** Die Roadmap führt Phase 3 als „Multi-Domain-TLS-Routing". Da TLS/Proxy per D-03/D-04 an den Betreiber (dokumentiert) delegiert wird, muss der Umfang von Phase 3 bei deren Planung neu bewertet werden — evtl. reduziert sich Phase 3 auf App-seitige Domain-Verifizierung + Doku statt eigener TLS-Routing-Implementierung.
- **Erster Admin-Bootstrap → Phase 2 (Auth).** Wie der erste Admin ohne Public-Signup entsteht (z. B. `INITIAL_ADMIN_EMAIL`-ENV), gehört zum User-Modell/Magic-Link in Phase 2, nicht in die Infra-Phase.

</deferred>

---

*Phase: 1-Test Infrastructure, Monorepo & Deployment Scaffolding*
*Context gathered: 2026-07-10*
