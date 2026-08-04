#!/usr/bin/env bash
# scripts/smoke-compose.sh - INFRA-01 boot smoke test.
#
# Proves `docker compose up` boots the full Zack stack with ZERO manual
# steps beyond supplying `.env`: migrations apply automatically at
# container start (D-05), `/health` returns 200, and a POST /api/canary
# succeeds (which can only happen if the PersistenceCanary table already
# exists - i.e. migrations really ran, not just that the server started).
#
# This script always tears the stack down at the end, INCLUDING the named
# volume (`down -v`) - it is a throwaway boot check, not the persistence
# test (see scripts/smoke-persistence.sh for the volume-preserving
# restart proof). Exits non-zero on any failure so CI can gate on it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
APP_URL="http://localhost:3000"
ENV_FILE_CREATED=0

cleanup() {
  local exit_code=$?
  echo "==> Tearing down (volume-removing - this is a throwaway boot check)"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  if [ "$ENV_FILE_CREATED" -eq 1 ]; then
    rm -f .env
  fi
  exit "$exit_code"
}
trap cleanup EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required to run this smoke test" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "FAIL: openssl is required to run this smoke test" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "==> No .env found - creating one from .env.example for this smoke run"
  cp .env.example .env
  ENV_FILE_CREATED=1
  # .env.example ships BETTER_AUTH_SECRET as the literal placeholder
  # "changeme-generate-a-real-32-plus-char-secret", which
  # apps/api/src/env.ts's fail-fast validator (WR-06) rejects by design -
  # copying it as-is crashes the app container at boot. Generate a real
  # secret here. `|` is used as the sed delimiter (not the default `/`)
  # because the base64 secret can itself contain `/`, but never `|`, `&`,
  # or `\`, so no replacement-side escaping is needed.
  generated_secret=$(openssl rand -base64 32)
  sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${generated_secret}|" .env
  rm -f .env.bak
  echo "==> Generated a random BETTER_AUTH_SECRET for this smoke run"
fi

echo "==> docker compose up -d --wait"
"${COMPOSE[@]}" up -d --wait

echo "==> GET /health"
health_status=$(curl -s -o /tmp/smoke-compose-health.json -w '%{http_code}' "$APP_URL/health")
if [ "$health_status" != "200" ]; then
  echo "FAIL: GET /health returned $health_status (expected 200)" >&2
  cat /tmp/smoke-compose-health.json >&2 || true
  exit 1
fi
echo "PASS: /health returned 200"

echo "==> POST /api/canary (proves migrations applied automatically - INFRA-01)"
canary_status=$(curl -s -o /tmp/smoke-compose-canary.json -w '%{http_code}' -X POST "$APP_URL/api/canary")
if [ "$canary_status" != "200" ]; then
  echo "FAIL: POST /api/canary returned $canary_status (expected 200) - migrations may not have applied" >&2
  cat /tmp/smoke-compose-canary.json >&2 || true
  exit 1
fi

token=$(jq -r '.token // empty' /tmp/smoke-compose-canary.json)
if [ -z "$token" ]; then
  echo "FAIL: POST /api/canary did not return a token" >&2
  cat /tmp/smoke-compose-canary.json >&2 || true
  exit 1
fi
echo "PASS: POST /api/canary succeeded (token=$token) - auto-migration confirmed"

echo "==> smoke-compose.sh: ALL CHECKS PASSED (INFRA-01)"
