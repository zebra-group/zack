---
phase: quick-260724-ecl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/smoke-compose.sh
  - scripts/smoke-persistence.sh
  - docs/DEPLOYMENT.md
autonomous: true
requirements: [INFRA-01, INFRA-03]

must_haves:
  truths:
    - "Running ./scripts/smoke-compose.sh from a clean checkout (no pre-existing .env) boots the app container healthy and exits 0 with 'ALL CHECKS PASSED' — the app process reaches the listening state instead of process.exit(1) at boot."
    - "The auto-created .env carries a freshly generated 32+ char BETTER_AUTH_SECRET (not the .env.example placeholder), so env.ts fail-fast validation (WR-06) passes and the Docker HEALTHCHECK on /health succeeds."
    - "A developer or operator can build, deploy, and troubleshoot the stack from docs/DEPLOYMENT.md alone — including recognizing the BETTER_AUTH_SECRET placeholder-rejection failure mode — without asking DevOps."
  artifacts:
    - scripts/smoke-compose.sh
    - scripts/smoke-persistence.sh
    - docs/DEPLOYMENT.md
  key_links:
    - "Both smoke scripts' ENV_FILE_CREATED=1 auto-create branch → generated secret substituted into .env BEFORE `docker compose up --wait` runs."
    - "docs/DEPLOYMENT.md ENV section → apps/api/src/env.ts (single source of truth) and → docs/deployment/reverse-proxy.md (TLS/reverse proxy, not duplicated)."
---

<objective>
Fix the CI "Compose boot & persistence smoke tests" job, which fails because the `app` container becomes unhealthy immediately after boot. Root cause (already diagnosed and re-confirmed during planning): `scripts/smoke-compose.sh` and `scripts/smoke-persistence.sh` both auto-create `.env` via `cp .env.example .env` when no `.env` exists. `.env.example` ships `BETTER_AUTH_SECRET=changeme-generate-a-real-32-plus-char-secret`, and `apps/api/src/env.ts`'s `envSchema` has a `.refine()` that rejects exactly that literal by design (WR-06). So `loadEnv()` calls `process.exit(1)` right after `prisma migrate deploy` succeeds, the server never listens on port 3000, the `/health` HEALTHCHECK fails, and `docker compose up --wait` reports the container unhealthy.

Purpose: Restore a green CI smoke job and document the deployment/build/troubleshooting surface (per the project's DevOps documentation convention) so this failure mode is self-diagnosable in future.

Output: Both smoke scripts generate a real random `BETTER_AUTH_SECRET` when they auto-create `.env`; a new `docs/DEPLOYMENT.md` grounded in the actual repo.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@apps/api/src/env.ts
@.env.example
@scripts/smoke-compose.sh
@scripts/smoke-persistence.sh
@apps/api/entrypoint.sh
@docker-compose.yml
@docker-compose.dev.yml
@Dockerfile
@docs/deployment/reverse-proxy.md
@.github/workflows/ci.yml
</context>

<interface_context>
Confirmed facts (verified during planning against the actual files):

- `apps/api/src/env.ts` L53-59: `BETTER_AUTH_SECRET: z.string().min(32).refine((v) => v !== "changeme-generate-a-real-32-plus-char-secret", { message: "BETTER_AUTH_SECRET is still the .env.example placeholder — generate a real secret (e.g. `openssl rand -base64 32`)." })`. This is the ONLY `.refine()` in the schema — every other `.env.example` value validates cleanly. The cross-field OIDC all-three-or-none guard in `parseEnv()` does NOT trip because `.env.example` leaves all three OIDC keys empty (normalized to "unset" by `OPTIONAL_ENV_KEYS`).
- `.env.example` L23 is the offending line: `BETTER_AUTH_SECRET=changeme-generate-a-real-32-plus-char-secret` (starts at column 0, so an anchored `^BETTER_AUTH_SECRET=` sed pattern matches).
- `scripts/smoke-compose.sh` L40-44: the `if [ ! -f .env ]; then ... cp .env.example .env; ENV_FILE_CREATED=1; fi` block. The `cp` is L42.
- `scripts/smoke-persistence.sh` L41-45: the same block. The `cp` is L43.
- Both scripts already `rm -f .env` on exit when `ENV_FILE_CREATED=1` (cleanup trap), so a generated secret is ephemeral per run and never persists.
- `openssl rand -base64 32` output is a single-line 44-char string over the base64 alphabet (`A-Za-z0-9+/=`) — it CAN contain `/`, so `sed`'s default `/` delimiter is unsafe; it NEVER contains `|`, `&`, or `\`, so `|` is a safe sed delimiter with no replacement-side escaping needed.
</interface_context>

<tasks>

<task type="auto">
  <name>Task 1: Generate a real BETTER_AUTH_SECRET when smoke scripts auto-create .env</name>
  <files>scripts/smoke-compose.sh, scripts/smoke-persistence.sh</files>
  <action>
In BOTH scripts, inside the existing `if [ ! -f .env ]; then ... fi` auto-create block (the `ENV_FILE_CREATED=1` branch — smoke-compose.sh around L40-44, smoke-persistence.sh around L41-45), add secret generation IMMEDIATELY AFTER the `cp .env.example .env` line and before the block closes. Do NOT restructure the scripts otherwise; keep the change minimal and localized to that branch so a real operator-supplied `.env` is never mutated.

The added logic (identical in both scripts): capture the output of `openssl rand -base64 32` into a shell variable, then do an in-place replacement of the freshly-copied `.env`'s `BETTER_AUTH_SECRET` line with that value using `sed`. Use an anchored pattern `^BETTER_AUTH_SECRET=.*` and the `|` character as the sed delimiter — chosen because the base64 secret can contain `/` (which would break the default `/` delimiter) but never contains `|`, `&`, or `\`, so no replacement-side escaping is needed. Use the portable in-place form `sed -i.bak "..." .env` (works on both the CI GNU sed and a developer's macOS BSD sed) and delete the `.env.bak` backup file afterward with `rm -f .env.bak`. Add a one-line echo (e.g. reporting that a secret was generated) but NEVER echo the secret value itself. Add a short code comment on WHY: the verbatim `.env.example` placeholder is rejected by `apps/api/src/env.ts`'s fail-fast validator (WR-06), so copying it as-is crashes the app container at boot.

Also, mirroring the existing `command -v jq` guard near the top of each script, add a matching `command -v openssl` availability guard (FAIL with a clear message + exit 1 if openssl is absent) so the scripts fail with a legible message rather than a cryptic `sed`-with-empty-value result if openssl is ever unavailable.

Do NOT modify `.env.example` — its placeholder-rejection behavior is intentional security design (WR-06); only the scripts' auto-creation logic changes.
  </action>
  <verify>
    <automated>bash -n scripts/smoke-compose.sh && bash -n scripts/smoke-persistence.sh</automated>
    <automated>docker compose -f docker-compose.yml build app && ./scripts/smoke-compose.sh</automated>
  </verify>
  <done>
`bash -n` reports no syntax errors in either script. Running `./scripts/smoke-compose.sh` from a checkout with NO pre-existing `.env` (temporarily move any local `.env` aside first, since the fix only fires in the auto-create branch) builds the image, boots the stack, and prints "smoke-compose.sh: ALL CHECKS PASSED (INFRA-01)" exiting 0 — proving the app container reaches a healthy /health instead of dying at ENV validation. The generated secret never appears in script stdout. Requires a running Docker daemon and outbound network (the Dockerfile build stage downloads the DB-IP GeoIP database).
  </done>
</task>

<task type="auto">
  <name>Task 2: Create docs/DEPLOYMENT.md grounded in the actual repo</name>
  <files>docs/DEPLOYMENT.md</files>
  <action>
Create `docs/DEPLOYMENT.md` (confirmed absent — only `docs/deployment/reverse-proxy.md` exists). Write it so both a DevOps-experienced person and a developer without a DevOps background can build, deploy, and troubleshoot the stack without asking DevOps. Base EVERY statement on facts already present in the repo (docker-compose.yml, docker-compose.dev.yml, Dockerfile, apps/api/entrypoint.sh, .env.example comments, apps/api/src/env.ts, .github/workflows/ci.yml) — do not invent infrastructure, hosts, or commands that are not grounded in those files. For TLS / reverse-proxy specifics, LINK to the existing `docs/deployment/reverse-proxy.md` instead of duplicating it (per the project's documentation convention: defer to existing docs, do not duplicate).

Include at minimum these sections:

1. Infrastructure overview — the production `docker-compose.yml` defines exactly two services: `app` (single Fastify image serving `/api/*`, the redirect handler, and the built Vue SPA via @fastify/static) and `db` (`postgres:18-alpine`). Data persists in the named volume `db-data` mounted at `/var/lib/postgresql` (note the deliberate non-`.../data` mount path per the compose comment). TLS/reverse-proxy termination is the operator's own responsibility (link to reverse-proxy.md). The dev/CI-only `docker-compose.dev.yml` overlay adds Mailpit as an SMTP catcher and must never be used in production.

2. Build process — the multi-stage `Dockerfile`: `base` (node:24-alpine + pnpm via corepack), `build` (`pnpm install --frozen-lockfile`, an explicit `prisma generate` run with a placeholder `DATABASE_URL` because prisma.config.ts resolves it eagerly, topological `pnpm run -r build`, the DB-IP GeoIP `.mmdb` bake, then `pnpm deploy --filter=@kurzly/api --prod --legacy /prod/api`), and `runtime` (pruned API + the Vue `dist/` copied into `public/`, the migration-on-start entrypoint, running as the non-root `node` user). The build command is `docker compose -f docker-compose.yml build app`.

3. Deploy flow — copy `.env.example` to `.env` and fill in real values (call out generating `BETTER_AUTH_SECRET` with `openssl rand -base64 32`), then `docker compose up -d --wait`. Migrations run automatically at container start via `apps/api/entrypoint.sh` (`prisma migrate deploy`, forward-only, safe on every restart — D-05) BEFORE the server listens. The `app` HEALTHCHECK curls `/health`.

4. Required ENV vars / secrets — state that `apps/api/src/env.ts` is the single source of truth and its fail-fast validator aborts boot with `exit 1` on any invalid/missing required var. Summarize the keys and where they are configured: everything lives in `.env` (compose `env_file: .env`), and `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` additionally initialize the `db` service and must stay in sync with the credentials embedded in `DATABASE_URL`. Note that in CI, the GitHub Actions `smoke` job auto-creates `.env` from `.env.example` and (after Task 1) injects a generated `BETTER_AUTH_SECRET`.

5. Troubleshooting — lead with the exact BETTER_AUTH_SECRET placeholder-rejection failure so a future operator or CI maintainer recognizes it instantly: SYMPTOM = the `app` container reports unhealthy right after boot and `docker compose up --wait` fails/times out; DIAGNOSIS = `docker compose logs app` shows the "Invalid environment configuration" line naming `BETTER_AUTH_SECRET` as still the `.env.example` placeholder; CAUSE = `.env`'s secret was never changed from the shipped placeholder, which `env.ts` rejects on purpose (WR-06); FIX = set a real secret via `openssl rand -base64 32`. Also document, grounded in the code: a PARTIAL OIDC config (some but not all three `OIDC_*` vars) fails boot by design; a missing/invalid `DATABASE_URL` aborts boot; and mounting the Postgres volume at `.../data` instead of `/var/lib/postgresql` makes postgres:18-alpine refuse to start.
  </action>
  <verify>
    <automated>test -f docs/DEPLOYMENT.md && grep -q "BETTER_AUTH_SECRET" docs/DEPLOYMENT.md && grep -q "prisma migrate deploy" docs/DEPLOYMENT.md && grep -q "reverse-proxy.md" docs/DEPLOYMENT.md</automated>
  </verify>
  <done>
`docs/DEPLOYMENT.md` exists and contains all five sections (infrastructure overview, build process, deploy flow, required ENV/secrets, troubleshooting). The troubleshooting section explicitly describes the app-container-unhealthy / `docker compose logs app` placeholder-rejection symptom and its fix. TLS content links to `docs/deployment/reverse-proxy.md` rather than duplicating it. No claim contradicts the actual docker-compose.yml / Dockerfile / entrypoint.sh / env.ts.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CI runner / local shell → generated `.env` → app container | The smoke scripts synthesize an ephemeral signing secret consumed by the app at boot. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ECL-01 | Information Disclosure | generated BETTER_AUTH_SECRET in smoke scripts | low | mitigate | Never echo the secret value (only a "secret generated" line); the secret is written to `.env` only, and both scripts already `rm -f .env` on exit in the `ENV_FILE_CREATED=1` branch, so it is per-run ephemeral and never committed. |
| T-ECL-02 | Tampering | weak/predictable signing secret | low | mitigate | Generate with `openssl rand -base64 32` (32 bytes CSPRNG, 256-bit), the exact method `.env.example` already documents — satisfies env.ts's `.min(32)` and is not a known/shared placeholder. |
| T-ECL-SC | Tampering | package installs | n/a | accept | No npm/pip/cargo installs in this plan; no new dependencies added (`openssl`/`sed` are baseline shell tooling already assumed by the scripts alongside `jq`). |
</threat_model>

<verification>
- `bash -n` passes on both modified scripts (no syntax regressions).
- With no pre-existing `.env`, `./scripts/smoke-compose.sh` exits 0 with "ALL CHECKS PASSED (INFRA-01)" — the definitive proof, since it exercises the full auto-create → generate secret → boot → /health → /api/canary path against a real docker compose stack (this is the project's established equivalent of a test for these infra scripts; no shell-unit harness exists in the repo).
- `.env.example` is unchanged (`git diff -- .env.example` is empty).
- `docs/DEPLOYMENT.md` exists with all five sections and the placeholder-rejection troubleshooting entry.
</verification>

<success_criteria>
- CI's "Compose boot & persistence smoke tests" job passes because the auto-created `.env` carries a valid generated secret instead of the rejected placeholder.
- Both scripts change ONLY inside their existing `ENV_FILE_CREATED=1` auto-create branch (plus the mirrored `openssl` guard); a real operator-supplied `.env` is never mutated.
- `docs/DEPLOYMENT.md` lets a reader build, deploy, and troubleshoot the stack — including this exact failure mode — without asking DevOps, with every statement grounded in the repo.
</success_criteria>

<output>
Create `.planning/quick/260724-ecl-fix-ci-smoke-tests-crashing-app-containe/260724-ecl-SUMMARY.md` when done.
</output>
