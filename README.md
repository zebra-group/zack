# Zack

Zack is a self-hosted, open-source URL shortener in the bit.ly / dub.co class, built for teams
that want their short links running on their own infrastructure. The core value: reliably
shorten and redirect short links on your own domains, self-hosted, with no third-party tracking.

## Features

- Short links with password protection, expiry, OG metadata, and CSV import
  (`apps/api/src/routes/links.ts`)
- Custom domains with DNS ownership verification and a TLS readiness check
  (`apps/api/src/routes/domains.ts`, `apps/api/src/routes/tlsCheck.ts`)
- Dynamic and static QR codes with logo overlay, custom color, and rounded modules
  (`apps/api/src/routes/qrCodes.ts`, `apps/api/src/routes/qrRedirect.ts`)
- First-party click tracking and analytics, with optional GeoIP country resolution and optional
  retention pruning (`apps/api/src/routes/analytics.ts`, `apps/api/src/routes/redirect.ts`)
- Invite-only, role-based team management (`apps/api/src/routes/team.ts`)
- Magic-link login with optional OIDC/SSO (`apps/api/src/routes/auth.ts`,
  `apps/api/src/routes/sso.ts`)
- Health and version endpoints for monitoring (`apps/api/src/routes/health.ts`,
  `apps/api/src/routes/version.ts`)

## Architecture at a glance

- Frontend: Vue 3 (Composition API)
- Backend: Fastify 5
- Database: PostgreSQL 18 via Prisma
- Auth: better-auth, magic-link plus optional OIDC/SSO

One Fastify instance serves the built SPA, `/api/*`, and the public redirect handler from the
same origin. The repo is a pnpm workspace monorepo: `apps/api`, `apps/web`, `apps/e2e`, and
`packages/shared`.

## Quickstart (Docker Compose)

Prerequisites: Docker with Compose v2.

1. Copy `.env.example` to `.env`.
2. Fill in the required values — at minimum `DATABASE_URL`, `POSTGRES_PASSWORD`, `BASE_URL`, a
   freshly generated `BETTER_AUTH_SECRET`, the SMTP settings (`SMTP_HOST`, `SMTP_PORT`,
   `SMTP_FROM`, and any auth your provider needs), and `INITIAL_ADMIN_EMAIL`.

   Generate a real secret rather than leaving the placeholder in place:

   ```bash
   openssl rand -base64 32
   ```

   Boot deliberately fails if `BETTER_AUTH_SECRET` is left at the `.env.example` placeholder
   value.
3. Start the stack:

   ```bash
   docker compose up -d
   ```

`docker-compose.yml` defines two services, `db` (PostgreSQL) and `app` (the Zack image, built
from the repo via `build: .`), plus the named volume `db-data` that persists Postgres data
across restarts. The `app` service publishes port 3000.

Database migrations apply automatically on every container start via
`apps/api/entrypoint.sh` — there is no manual migration step.

There is no public signup. `INITIAL_ADMIN_EMAIL` is the one seeded account that can always log
in; everyone else arrives by invitation from an existing admin.

Never pass `-v` to `docker compose down` for a routine restart — that destroys the `db-data`
volume and all stored data.

TLS termination and the reverse proxy in front of the app are the operator's own
responsibility. See [`docs/deployment/reverse-proxy.md`](docs/deployment/reverse-proxy.md) for
copy-pasteable setups.

## Configuration

`apps/api/src/env.ts` is the single source of truth for every environment variable Zack reads;
`.env.example` documents the same set with inline comments. Full detail, including
troubleshooting for boot failures, lives in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#4-required-env-vars--secrets).

**Required, no default**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string used by `app` |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP server port |
| `SMTP_FROM` | Magic-link sender address |
| `BASE_URL` | Public origin the app is served from (magic-link and redirect URLs) |
| `BETTER_AUTH_SECRET` | Session/token signing secret, min 32 chars — must not be the `.env.example` placeholder |
| `INITIAL_ADMIN_EMAIL` | The one seeded owner/admin account that can always log in |

**Optional, with a default**

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `3000` | HTTP port the Fastify server listens on |
| `SMTP_SECURE` | `false` | Whether SMTP uses TLS |
| `SMTP_USER` | (empty) | SMTP auth username |
| `SMTP_PASS` | (empty) | SMTP auth password |
| `TRUST_PROXY` | `false` | Whether Fastify trusts `X-Forwarded-For` — see note below |
| `CNAME_TARGET` | `shortener.zack.local` | CNAME target for subdomain ownership verification |
| `A_RECORD_IP` | `0.0.0.0` | A-record target for apex-domain ownership verification |
| `BRAND_NAME` | `Zack` | Brand text on public pages — see Branding below |
| `BRAND_ACCENT` | `#d7ff01` | Accent color on public pages — see Branding below |
| `PASSWORD_HASH_COST` | `11` | bcryptjs cost factor for link passwords |

**Optional, no default — absence turns the feature off**

| Variable | Purpose |
|---|---|
| `GEOIP_DB_PATH` | Path to an operator-supplied GeoIP `.mmdb`; unset uses the build-baked database |
| `CLICK_RETENTION_DAYS` | Days of raw click events to keep before pruning; unset disables pruning |
| `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Optional SSO — all three or none |

The compose-level `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` variables initialize
the `db` service itself. Postgres never parses `DATABASE_URL` — keep these three values in sync
with the credentials embedded in `DATABASE_URL`, or `app` will fail to connect even though `db`
boots fine.

Notes:

- **`TRUST_PROXY`**: set it `true` only when Zack sits behind a reverse proxy that terminates
  TLS and sets `X-Forwarded-For` — without that, `request.ip` resolves to the proxy's own
  address and every user's rate-limit bucket collapses into one shared bucket, so a single bad
  actor can lock out every legitimate user. Leave it `false` for a directly exposed deployment
  with no proxy in front; the `false` default is the fail-safe choice, since a directly exposed
  server would otherwise trust a spoofable `X-Forwarded-For` header from any client.
- OIDC/SSO is all three variables or none — a partial set is a boot-time configuration error,
  never a half-enabled login path. Register this callback URL with your IdP (with your real
  `BASE_URL`): `{BASE_URL}/api/auth/oauth2/callback/oidc`.
- `GEOIP_DB_PATH` unset means the build-baked country database bundled in the image is used.
  `CLICK_RETENTION_DAYS` unset means retention pruning is off.
- `PASSWORD_HASH_COST` is the bcryptjs cost factor for link passwords; keep it conservative
  (10-11) so the redirect hot path does not block under concurrent password verification.

## Branding

`BRAND_NAME` sets the brand text shown on the public pages and the logo tile glyph — the
rendered glyph is simply the first character of `BRAND_NAME`, uppercased
(`apps/api/src/lib/publicHtml.ts:164`). `BRAND_ACCENT` overrides the `--accent` CSS variable in
the public pages' inline `<style>` block. Both are read from `process.env` at request time
(`apps/api/src/routes/redirect.ts:64-67`), so a container restart is enough to apply a change —
no rebuild required.

**Scope limit:** this only reaches the server-rendered public pages — the password gate, the
expiry page, the 404 page, and the bot OG tags. The dashboard SPA is not branded; the name is
hardcoded in its source (`apps/web/src/layouts/AppShell.vue`, `apps/web/src/views/LoginView.vue`,
`apps/web/src/views/AuthErrorView.vue`, `apps/web/index.html`, plus prose in
`apps/web/src/views/DashboardView.vue`, `apps/web/src/views/DomainsView.vue`, and
`apps/web/src/views/TeamView.vue`). Anyone who needs a white-labelled dashboard must first
surface `BRAND_NAME` to the SPA through a public config endpoint, which is not built yet.

Two cautions: there is no logo image for the public pages, only the letter tile; and
`BRAND_ACCENT` is validated only as a non-empty string and interpolated into the stylesheet
without escaping, so it must be a valid CSS color — a typo silently breaks the page layout.

This is distinct from per-QR-code branding (logo upload, color, and rounded modules via the QR
Studio), which is stored per QR code in the database as a user feature, not instance-level
configuration.

## Development

Requires Node.js 24.x (`engines.node` in `package.json`).

```bash
pnpm install
pnpm typecheck
pnpm build
```

For tests, use the CI form:

```bash
pnpm run -r --filter='!@zack/e2e' test
```

Do not run the bare root `pnpm test` — it also launches the Playwright suite (`@zack/e2e`)
against a Compose stack that is not booted, and will fail. The E2E suite runs separately via
`scripts/e2e-compose.sh`, which boots the built app image plus supporting services and needs
host ports 3000, 5433, 8025, and 9000 free.

The project is strictly test-driven: tests are written first, then the implementation that
makes them pass, and CI runs the full suite on every change. See
[`.claude/CLAUDE.md`](.claude/CLAUDE.md) for the project's contribution and testing
conventions.

## Documentation

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — infrastructure overview, build process, deploy
  flow, required ENV vars and secrets, troubleshooting, and versioned GHCR image releases.
- [`docs/deployment/reverse-proxy.md`](docs/deployment/reverse-proxy.md) — reverse proxy and TLS
  setup.
- [`.env.example`](.env.example) — the full annotated ENV surface.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## License

No license has been chosen for this project yet.
