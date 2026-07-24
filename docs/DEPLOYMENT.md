# Deployment

This document describes how to build, deploy, and troubleshoot the Kurzly
stack from the actual files in this repo (`docker-compose.yml`,
`docker-compose.dev.yml`, `Dockerfile`, `apps/api/entrypoint.sh`,
`.env.example`, `apps/api/src/env.ts`, `.github/workflows/ci.yml`). No step
here requires anything beyond a Docker host and this repository — you
should not need to ask DevOps to build or run Kurzly.

## 1. Infrastructure overview

The production `docker-compose.yml` defines exactly **two services**:

- **`app`** — a single Fastify image serving `/api/*`, the public
  redirect handler, and the built Vue SPA (via `@fastify/static`). Only
  this service's port (`3000`) is published to the host.
- **`db`** — `postgres:18-alpine`. It is reachable from `app` over the
  internal Compose network only; its port is never published to the
  host.

Data persists in the named volume `db-data`, mounted at
`/var/lib/postgresql` — **not** `.../data`. This is deliberate: the
`postgres:18-alpine` image manages its own major-version-specific
subdirectory under `/var/lib/postgresql` itself and refuses to start if
the volume is mounted directly at `.../data` instead (see the comment in
`docker-compose.yml`, confirmed empirically against this image). Never
change this mount path.

TLS termination and the reverse proxy in front of the `app` port are the
**operator's own responsibility** — Kurzly does not bundle one. See
[`docs/deployment/reverse-proxy.md`](./deployment/reverse-proxy.md) for
copy-pasteable Caddy/nginx/Traefik configs, including the on-demand TLS
integration for dynamically-registered custom domains.

`docker-compose.dev.yml` is a **dev/CI-only overlay** that adds Mailpit
(an SMTP catcher for inspecting magic-link emails without a real SMTP
provider). It is only ever combined with the production compose file
via `-f docker-compose.yml -f docker-compose.dev.yml` and must **never**
be used in production.

## 2. Build process

The image is built from the multi-stage `Dockerfile`:

1. **`base`** — `node:24-alpine` with `pnpm` enabled via `corepack`.
   Shared by both later stages.
2. **`build`** — installs the full pnpm workspace
   (`pnpm install --frozen-lockfile`), then:
   - Runs `prisma generate` **explicitly** with a placeholder
     `DATABASE_URL` (`postgresql://placeholder:placeholder@localhost:5432/placeholder`).
     This is required because `prisma.config.ts` resolves `DATABASE_URL`
     eagerly via `env()` even for `generate`, which never opens a real
     DB connection — the placeholder just unblocks config loading at
     build time.
   - Builds the workspace topologically (`pnpm run -r build`), so
     `packages/shared` builds before `apps/web`/`apps/api`, which both
     depend on it.
   - Bakes the DB-IP GeoIP `.mmdb` database into the image at **build
     time only** (downloaded via `curl`, then `gunzip`'d) — Kurzly never
     fetches this at runtime, so the image works fully offline/air-gapped
     out of the box.
   - Prunes to a standalone production-only directory via
     `pnpm deploy --filter=@kurzly/api --prod --legacy /prod/api`. The
     `--legacy` flag matters: it performs a real content copy instead of
     pnpm 10+'s default injected/symlinked workspace mode, so the pruned
     output is self-contained and safe to `COPY` into the runtime stage.
3. **`runtime`** — the actual shipped image: the pruned API, the built
   Vue `dist/` copied into the API's `public/` directory (single-origin
   serving — the same Fastify process serves both the API and the SPA),
   the baked GeoIP database, and the migration-on-start entrypoint. Runs
   as the non-root `node` user.

Build command:

```bash
docker compose -f docker-compose.yml build app
```

Migrations are **never** run as a Dockerfile `RUN` step — only at
container start (see Section 3).

## 3. Deploy flow

1. Copy `.env.example` to `.env` and fill in real values:

   ```bash
   cp .env.example .env
   ```

2. Generate a real `BETTER_AUTH_SECRET` (min 32 chars) and set it in
   `.env` — **do not leave the shipped placeholder in place** (see the
   Troubleshooting section below for why this matters):

   ```bash
   openssl rand -base64 32
   ```

3. Start the stack:

   ```bash
   docker compose up -d --wait
   ```

   `--wait` blocks until both services report healthy, so a failed boot
   (e.g. a rejected `BETTER_AUTH_SECRET`) surfaces immediately as a
   non-zero exit instead of silently leaving an unhealthy container
   running in the background.

No manual migration step is needed: `apps/api/entrypoint.sh` runs
`prisma migrate deploy` automatically every time the `app` container
starts, **before** the server begins listening. `migrate deploy` is
forward-only and non-destructive — it never resets or drops data, so
it's safe to run on every restart, including against a database that
already has data.

The `app` service's `HEALTHCHECK` curls `/health` (technically a Node
`fetch` call baked into the image, see `Dockerfile`/`docker-compose.yml`)
every 10s, with a 30s `start_period` to tolerate the migration step and
server startup.

**Never** run `docker compose down -v` as part of a routine
restart or redeploy — the `-v` flag removes the `db-data` named volume
and destroys all persisted data. Routine restarts should only ever use:

```bash
docker compose down
docker compose up -d --wait
```

## 4. Required ENV vars / secrets

`apps/api/src/env.ts` is the **single source of truth** for every
environment variable Kurzly reads. Its fail-fast validator
(`loadEnv()`) runs before the server touches the database, SMTP, or
anything else — an invalid or missing required variable prints a clear
error to stderr and aborts the process with `exit(1)` rather than
crashing cryptically later.

Everything lives in one `.env` file, referenced by
`docker-compose.yml`'s `env_file: .env` on the `app` service.
`.env.example` documents every key the schema reads (a drift test in the
repo, `apps/api/test/env-example-drift.test.ts`, fails the build if that
ever falls out of sync).

Key groups, summarized (see `.env.example`'s inline comments for the
full detail on each):

| Variable(s) | Purpose |
|---|---|
| `NODE_ENV`, `PORT`, `BASE_URL` | Basic app/runtime config |
| `BETTER_AUTH_SECRET` | Session/token signing secret, min 32 chars — see Troubleshooting below |
| `DATABASE_URL` | Postgres connection string used by `app` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Initialize the `db` service itself. Postgres never parses `DATABASE_URL` — **these three values must stay in sync with the credentials embedded in `DATABASE_URL`**, or `app` will fail to connect even though `db` boots fine. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Magic-link email delivery |
| `INITIAL_ADMIN_EMAIL` | The one seeded owner/admin email that can always log in — required so a fresh instance is never un-loginable |
| `TRUST_PROXY` | Set `true` only when running behind a reverse proxy that sets `X-Forwarded-For` (see Section 1/reverse-proxy.md) |
| `CNAME_TARGET`, `A_RECORD_IP` | Fixed DNS targets operators point custom domains at for ownership verification |
| `BRAND_NAME`, `BRAND_ACCENT` | Branding for the public redirect/password/expiry pages only (not the dashboard SPA) |
| `PASSWORD_HASH_COST` | bcryptjs cost factor for link passwords |
| `GEOIP_DB_PATH` | Optional override path for a bind-mounted `.mmdb`; unset uses the build-baked database |
| `CLICK_RETENTION_DAYS` | Optional click-event retention window; unset means no pruning |
| `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Optional SSO. All three or none — a partial set is a boot-time error, not a half-enabled login path |

In CI, the GitHub Actions `smoke` job (`.github/workflows/ci.yml`) builds
the image and then auto-creates `.env` from `.env.example` inside
`scripts/smoke-compose.sh`/`scripts/smoke-persistence.sh` when no `.env`
is present. Those scripts also generate a real `BETTER_AUTH_SECRET` at
that point (via `openssl rand -base64 32`) — see Troubleshooting below
for the exact failure this replaces.

## 5. Troubleshooting

### `app` container reports unhealthy right after boot

**Symptom:** `docker compose up --wait` fails or times out; `docker ps`
shows the `app` container as `unhealthy`.

**Diagnosis:** run `docker compose logs app`. If you see:

```
Invalid environment configuration:
  - BETTER_AUTH_SECRET: BETTER_AUTH_SECRET is still the .env.example placeholder — generate a real secret (e.g. `openssl rand -base64 32`).
```

**Cause:** `.env.example` ships `BETTER_AUTH_SECRET` as the literal
placeholder `changeme-generate-a-real-32-plus-char-secret`. This is
intentionally rejected by `apps/api/src/env.ts`'s fail-fast validator —
if a plain `.min(32)` check were the only rule, the placeholder (which
happens to be over 32 characters) would validate and silently ship a
publicly-known signing secret. `loadEnv()` calls `process.exit(1)` right
after `prisma migrate deploy` succeeds, so the server never starts
listening on port 3000, the `/health` `HEALTHCHECK` fails, and the
container is reported unhealthy.

**Fix:** set a real secret in `.env`:

```bash
openssl rand -base64 32
```

Copy the output into `BETTER_AUTH_SECRET=` in `.env`, then
`docker compose up -d --wait` again.

### Other boot-time configuration failures (same class of error)

These all surface the same way (an `Invalid environment configuration`
block in `docker compose logs app`, followed by the container never
becoming healthy) because they all go through the same `loadEnv()` gate:

- **Partial OIDC/SSO config.** Setting only one or two of
  `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` fails boot
  by design — SSO is either fully configured (all three) or fully
  absent (none). A partial set is treated as a configuration error, not
  a half-enabled login path.
- **Missing or invalid `DATABASE_URL`.** `app` aborts boot rather than
  attempting to connect with a bad connection string.

### Postgres refuses to start after changing the volume mount

If the `db-data` volume is ever mounted at `/var/lib/postgresql/data`
instead of `/var/lib/postgresql`, `postgres:18-alpine` refuses to start.
Do not change this mount path in `docker-compose.yml`.

### Data loss after a restart

If data appears to have been lost across a restart, check whether
`docker compose down -v` was run — the `-v` flag removes the `db-data`
named volume. Routine restarts must never use `-v` (see Section 3).

### TLS / reverse proxy issues

Not covered here — see
[`docs/deployment/reverse-proxy.md`](./deployment/reverse-proxy.md) for
Caddy/nginx/Traefik setup, including the on-demand TLS integration for
dynamically-registered custom domains via `GET /api/tls-check`.
