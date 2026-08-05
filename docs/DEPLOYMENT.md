# Deployment

This document describes how to build, deploy, and troubleshoot the Zack
stack from the actual files in this repo (`docker-compose.yml`,
`docker-compose.dev.yml`, `Dockerfile`, `apps/api/entrypoint.sh`,
`.env.example`, `apps/api/src/env.ts`, `.github/workflows/ci.yml`). No step
here requires anything beyond a Docker host and this repository — you
should not need to ask DevOps to build or run Zack.

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
**operator's own responsibility** — Zack does not bundle one. See
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
     time only** (downloaded via `curl`, then `gunzip`'d) — Zack never
     fetches this at runtime, so the image works fully offline/air-gapped
     out of the box.
   - Prunes to a standalone production-only directory via
     `pnpm deploy --filter=@zack/api --prod --legacy /prod/api`. The
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
container start (see Section 3). Operators can also skip building
altogether and pull a prebuilt versioned image published by CI instead
— see Section 6.

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
environment variable Zack reads. Its fail-fast validator
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

### Migration note: `POSTGRES_USER` / `POSTGRES_DB` default value changed

**What changed:** this rebrand changed `docker-compose.yml`'s built-in
fallbacks for `POSTGRES_USER` and `POSTGRES_DB` from the project's
previous product name to `zack`.

**Who is affected:** only installs that relied on those built-in
`${VAR:-...}` fallbacks rather than setting `POSTGRES_USER`/`POSTGRES_DB`
explicitly in their own `.env`. Their persisted `db-data` volume still
holds a Postgres role and database named after the previous product name,
so `app` would try to authenticate as a role that no longer matches the
new default.

Pick one of two remediation paths:

- **Option 1 (least invasive) — pin the old values explicitly in `.env`:**
  set `POSTGRES_USER` and `POSTGRES_DB` explicitly to whatever value your
  running Postgres role/database were actually created with (the project's
  previous product name, if you never overrode it), and keep
  `DATABASE_URL` consistent with those same values. Nothing in the
  database changes; the app keeps connecting exactly as before.
- **Option 2 (align with the new default) — rename the role/database
  inside the running Postgres:**

  ```sql
  ALTER ROLE <old_role_name> RENAME TO zack;
  ALTER DATABASE <old_db_name> RENAME TO zack;
  ```

  Then update `POSTGRES_USER`, `POSTGRES_DB`, and `DATABASE_URL` in `.env`
  to match. Note that `ALTER DATABASE ... RENAME` requires no other
  session to be connected to that database at the time — stop the `app`
  container first (`docker compose stop app`), run the two statements
  against `db` directly, update `.env`, then `docker compose up -d --wait`.

**Why this was accepted as-is:** `.env.example` already prescribes
explicit `POSTGRES_USER`/`POSTGRES_DB` values rather than relying on the
compose fallback, and this repository is private/pre-release, so no
production install is known to depend on the old fallback. This is a
deliberate, recorded tradeoff, not an oversight.

**Local hygiene (optional, dev/test only):** the e2e Compose project name
also changed to `zack-e2e`. A developer with a stale stack from the old
project name can clean it up once with:

```bash
docker compose -p <old-project-name> down -v --remove-orphans
```

This only removes throwaway e2e test volumes, never production data.

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

## 6. Versioned releases and GHCR image publishing

In addition to building the image yourself (Section 2), CI cuts
versioned releases and publishes a prebuilt image tied to each one.

**How releases are cut:** the `release` job in
`.github/workflows/ci.yml` runs [semantic-release](https://semantic-release.gitbook.io/)
on every push to `main`, but only after the `test` and `smoke` jobs both
pass (`needs: [test, smoke]`). It analyzes the conventional commits
(`feat:`, `fix:`, etc.) added since the last release and, when there is
a releasable change, automatically creates a Git tag and a GitHub
Release with an auto-generated changelog — there is no manual
review-PR gate. With no pre-existing tags, the first release is
`v1.0.0`. Pull requests and pushes to any branch other than `main`
never run this job.

**The token story:** the entire flow — cutting the release AND
publishing the image — runs under the **one built-in `GITHUB_TOKEN`**.
There is **no personal access token (PAT)** and **no extra Actions
secret to provision**. The `release` job is granted
`contents: write`, `issues: write`, `pull-requests: write` (so
semantic-release can push the tag, push its `CHANGELOG.md`/
`package.json` write-back commit, and comment on/close referenced
issues and PRs) plus `packages: write` (so the same job can push the
image to GHCR) — all satisfied by that single token.

**Where and when the image builds now:** in the SAME `release` job,
immediately after semantic-release runs. The job captures the latest
Git tag before running semantic-release and again afterward (re-fetching
tags first, since semantic-release pushed the new tag to the remote);
only when a NEW tag appeared does it build the same multi-stage
`Dockerfile` and push to `ghcr.io/zebra-group/zack`. **The image is no
longer built on every push to `main`** — a push whose commits produce no
releasable change (e.g. a `docs:`/`chore:`-only commit) cuts no release,
so the docker steps are skipped and no image is built that run.

**Tags:** each release publishes four tags, built directly from the
released SemVer:

| Tag | Meaning |
|---|---|
| `1.2.3` | Exact version — pin this for reproducible or rollback-safe production deploys. |
| `1.2` | Tracks the newest `1.2.x` patch release. |
| `1` | Tracks the newest `1.x.y` release. |
| `latest` | Always tracks the newest published release. |

The old floating `main` / `sha-<short-git-sha>` tags from the
push-per-commit flow are gone — they no longer add value now that every
published image is tied to a real, version-pinnable release.

**How to pull a specific version:**

```bash
docker pull ghcr.io/zebra-group/zack:1.2.3
# or a moving track:
docker pull ghcr.io/zebra-group/zack:1.2
docker pull ghcr.io/zebra-group/zack:1
docker pull ghcr.io/zebra-group/zack:latest
```

For a public package no authentication is needed — the `docker pull`
commands above work as-is on any host.

### GHCR package visibility is separate from repository visibility

`ghcr.io/zebra-group/zack` is **already public**, so the pull commands
above need no login. This section exists because that is a property of
the package, not of the repository — worth knowing if you fork Zack or
re-publish it under your own namespace.

A GHCR package's visibility is **not** derived from the repository's. A
package first published from a private repository inherits PRIVATE
visibility and **keeps it even after the repository becomes public**. The
result is a public repo whose own documented `docker pull` fails for
everyone but the maintainers — and nothing warns you about it.

Where to change it: GitHub → the repository's **Packages** section → the
`zack` package → **Package settings** → **Change visibility**.

To verify that a package really is anonymously pullable, check without
using your local Docker credentials at all:

```bash
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:zebra-group/zack:pull&service=ghcr.io" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/vnd.oci.image.index.v1+json' \
  https://ghcr.io/v2/zebra-group/zack/manifests/latest
```

`200` means anonymous pulls work. This is more reliable than
`docker logout && docker pull`, which can still succeed from a cached
credential helper or a warm local layer cache and give a false positive.

**When the package is deliberately kept private** (a fork, an internal
build, or before publication), an out-of-band pull needs a GitHub
username plus a Personal Access Token carrying the `read:packages`
scope:

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin
docker pull ghcr.io/zebra-group/zack:1.2.3
```

That `read:packages` PAT is a **pull-time-only** credential for an
out-of-band `docker pull`. It is unrelated to the release process, which
(as above) needs no PAT at all: the CI job's own `GITHUB_TOKEN` is valid
only inside that workflow run and cannot be reused for an external pull.

**Where the changelog lives:** `CHANGELOG.md` at the repo root,
auto-generated by `@semantic-release/changelog` from the conventional
commits included in each release, and committed back to `main` by
`@semantic-release/git`. That write-back commit's message always
contains `[skip ci]`, which GitHub natively honors to skip triggering a
new push-driven CI run for it — otherwise the write-back commit would
loop back into `ci.yml` and try to cut another release from itself.

**Pulling instead of building locally:** this is a drop-in alternative
to `docker compose build` (Section 2) for production hosts that would
rather not run a full workspace build themselves. To consume a
published image via Compose, you would set `image:
ghcr.io/zebra-group/zack:1.2.3` (or `:latest`) on the `app` service in
place of `build: .`. The committed `docker-compose.yml` intentionally
still builds locally by default, so no compose file changes are
required to keep using local builds.
