#!/usr/bin/env bash
# scripts/e2e-compose.sh - INFRA-01 canonical, CI-gating E2E entrypoint.
#
# Boots the 3-file compose stack (docker-compose.yml + docker-compose.dev.yml
# + docker-compose.e2e.yml) under project name kurzly-e2e, waits on the
# app's existing HEALTHCHECK, runs the Playwright suite (@zack/e2e)
# against the built image at http://localhost:3000, and ALWAYS tears the
# stack down (`down -v --remove-orphans`) - even on failure - so this is the
# one command CI (and local devs) run to exercise Kurzly's Core Value as
# actually deployed, never a split Vite/tsx dev server.
#
# Usage: ./scripts/e2e-compose.sh [extra playwright args, e.g. --workers=1]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(docker compose -p kurzly-e2e -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.e2e.yml)
ENV_FILE_CREATED=0

cleanup() {
  local exit_code=$?
  echo "==> Tearing down kurzly-e2e stack (down -v --remove-orphans)"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  if [ "$ENV_FILE_CREATED" -eq 1 ]; then
    rm -f .env
  fi
  exit "$exit_code"
}
trap cleanup EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required to run the E2E suite" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "FAIL: openssl is required to run the E2E suite" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "==> No .env found - creating one from .env.example for this E2E run"
  cp .env.example .env
  ENV_FILE_CREATED=1
  # .env.example ships BETTER_AUTH_SECRET as the literal placeholder
  # "changeme-generate-a-real-32-plus-char-secret", which apps/api/src/env.ts's
  # fail-fast validator (WR-06) rejects by design - generate a real secret
  # here, mirroring scripts/smoke-compose.sh exactly. `|` is used as the sed
  # delimiter (not the default `/`) because the base64 secret can itself
  # contain `/`, but never `|`, `&`, or `\`, so no replacement-side escaping
  # is needed.
  generated_secret=$(openssl rand -base64 32)
  sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${generated_secret}|" .env
  rm -f .env.bak
  echo "==> Generated a random BETTER_AUTH_SECRET for this E2E run"
fi

# Narrow rate-limit test bypass secret (INFRA-06, T-11-01) - generate a
# fresh one if the caller (CI) hasn't already supplied one. Never hardcoded,
# never written into docker-compose.e2e.yml itself; only ever lives in this
# script's/CI's own process environment.
export E2E_RATE_LIMIT_BYPASS_SECRET="${E2E_RATE_LIMIT_BYPASS_SECRET:-$(openssl rand -hex 32)}"

echo "==> docker compose up -d --wait (kurzly-e2e)"
"${COMPOSE[@]}" up -d --wait

# Host-runner env contract for @zack/e2e. Derive Postgres credentials from
# the same .env POSTGRES_* values the base compose's `db` service itself
# uses (default kurzly/changeme/kurzly per .env.example), rather than
# assuming they were never customized.
pg_user=$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | tail -n1 | cut -d'=' -f2-)
pg_password=$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | tail -n1 | cut -d'=' -f2-)
pg_db=$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | tail -n1 | cut -d'=' -f2-)
export E2E_DATABASE_URL="postgresql://${pg_user:-kurzly}:${pg_password:-changeme}@localhost:5433/${pg_db:-kurzly}"
export MAILPIT_URL="http://localhost:8025"
export PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:3000}"
# Host-published mock OIDC IdP (13-01-PLAN.md) -- apps/e2e/src/oidc-mock.ts's
# client targets this for the PUT/DELETE /__test__/profile test-control
# endpoint (docker-compose.e2e.yml's `oidc-mock` service, host port 9000).
export OIDC_MOCK_CONTROL_URL="http://localhost:9000"

echo "==> pnpm --filter @zack/e2e test"
pnpm --filter @zack/e2e test "$@"
