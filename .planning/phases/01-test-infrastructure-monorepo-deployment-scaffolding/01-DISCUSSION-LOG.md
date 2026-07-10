# Phase 1: Test Infrastructure, Monorepo & Deployment Scaffolding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-10
**Phase:** 1-Test Infrastructure, Monorepo & Deployment Scaffolding
**Areas discussed:** Deployment-Topologie, Reverse-Proxy & TLS, Betreiber-Erststart, Test-Harness-Layout

---

## Deployment-Topologie

| Option | Description | Selected |
|--------|-------------|----------|
| Single-Image | Fastify serviert Vue-`dist/` via `@fastify/static`; ein Container, gleiche Origin, kein CORS in prod | ✓ |
| Getrennte Container | Eigener web-Container + api-Container; sauberere Trennung, aber CORS + mehr Compose-Komplexität | |

**User's choice:** Single-Image
**Notes:** Redirect-Handler, API und SPA leben im selben `app`-Prozess; Produktions-Compose = `app` + `db`.

---

## Reverse-Proxy & TLS

| Option | Description | Selected |
|--------|-------------|----------|
| Caddy (on-demand TLS) | Automatische Let's-Encrypt-Zerts pro neuer Kundendomain | |
| Traefik | Dynamische Config via Labels/Provider | |
| nginx + certbot | Klassisch, aber Reload pro Domain | |
| **Betreiber-Sache, dokumentiert** | Kein fester Proxy im Produkt; Beispiele (Caddy/nginx/Traefik/certbot) in der Doku | ✓ |

**User's choice:** Free-text — „das würde ich dem Endnutzer überlassen; im späteren Projekt dokumentieren mit Beispielen für Caddyfile / nginx-conf / certbot-Hinweis / Traefik-Labels".
**Notes:** Folgefrage zur Compose-Umsetzung → gewählt: **App-Port exponieren, Proxy dokumentiert** (statt optionalem Caddy-Profil). Compose startet nur `app` + `db`.

---

## Betreiber-Erststart

### DB-Migration

| Option | Description | Selected |
|--------|-------------|----------|
| Automatisch beim App-Start | Entrypoint führt `prisma migrate deploy` vor Serverstart aus | ✓ |
| Separater Migrations-Service | Kurzlebiger Compose-Service, app wartet darauf | |
| Manuell / dokumentiert | Betreiber führt Migration selbst aus | |

**User's choice:** Automatisch beim App-Start

### ENV-Konfiguration

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-fast mit Schema-Validierung | Zod/Typebox-Validierung beim Boot, `exit 1` bei Fehlkonfiguration; `.env.example` dokumentiert alle Vars | ✓ |
| Locker / Defaults wo möglich | Nur Nötigstes prüfen, Defaults setzen | |

**User's choice:** Fail-fast mit Schema-Validierung
**Notes:** Erster-Admin-Bootstrap bewusst nach Phase 2 (Auth) verschoben.

---

## Test-Harness-Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: Rollback + dedizierte Migrationstests | Container/Worker, Seed einmal, Test in TX→Rollback; frischer Container nur für Migrations-/Schema-Tests | ✓ |
| Frischer Container pro Test/Datei | Maximale Isolation, aber langsamer | |
| Du entscheidest beim Planen | Strategie dem Planner überlassen | |

**User's choice:** Hybrid: Rollback + dedizierte Migrationstests

---

## Claude's Discretion

- Healthchecks, `depends_on`/Wartelogik, Multi-Stage-Dockerfile-Details, pnpm-Workspace-Feinheiten, exakte testcontainers-Verdrahtung — dem Planner/Researcher überlassen (auf Basis CLAUDE.md Tech-Stack).

## Deferred Ideas

- Reverse-Proxy/TLS als Produktcode → Umfang von Phase 3 (Multi-Domain-TLS-Routing) bei deren Planung neu bewerten.
- Erster-Admin-Bootstrap (z. B. `INITIAL_ADMIN_EMAIL`) → Phase 2 (Auth/User-Modell).
