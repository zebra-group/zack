#!/usr/bin/env bash
# scripts/smoke-persistence.sh - INFRA-03/D-08 persistence smoke test.
#
# Proves Postgres data survives a full `docker compose down` / `up` cycle
# via the named `db-data` volume: writes a canary row, performs a
# VOLUME-PRESERVING restart, then asserts the row is still there.
#
# CRITICAL: the down/up cycle in the middle of this script must NEVER pass
# `-v` (or any equivalent volume-removal flag) - that would destroy the
# exact durability guarantee (INFRA-03) this script exists to prove. Only
# the FINAL cleanup (after the assertion) removes the volume, so the host
# is left clean once the test has run.
#
# Exits non-zero on any failure so CI can gate on it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
APP_URL="http://localhost:3000"
ENV_FILE_CREATED=0

cleanup() {
  local exit_code=$?
  echo "==> Final teardown (volume-removing - test is complete, leaving host clean)"
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

if [ ! -f .env ]; then
  echo "==> No .env found - creating one from .env.example for this smoke run"
  cp .env.example .env
  ENV_FILE_CREATED=1
fi

echo "==> docker compose up -d --wait (first boot)"
"${COMPOSE[@]}" up -d --wait

echo "==> POST /api/canary (write a row to prove persistence against)"
canary_status=$(curl -s -o /tmp/smoke-persistence-post.json -w '%{http_code}' -X POST "$APP_URL/api/canary")
if [ "$canary_status" != "200" ]; then
  echo "FAIL: POST /api/canary returned $canary_status (expected 200)" >&2
  cat /tmp/smoke-persistence-post.json >&2 || true
  exit 1
fi

written_token=$(jq -r '.token // empty' /tmp/smoke-persistence-post.json)
written_total=$(jq -r '.total // empty' /tmp/smoke-persistence-post.json)
if [ -z "$written_token" ]; then
  echo "FAIL: POST /api/canary did not return a token" >&2
  exit 1
fi
echo "Wrote canary token=$written_token (total=$written_total)"

echo "==> docker compose down (VOLUME-PRESERVING - no -v)"
"${COMPOSE[@]}" down --remove-orphans

echo "==> docker compose up -d --wait (restart against the SAME named volume)"
"${COMPOSE[@]}" up -d --wait

echo "==> GET /api/canary (assert the row survived the restart)"
get_status=$(curl -s -o /tmp/smoke-persistence-get.json -w '%{http_code}' "$APP_URL/api/canary")
if [ "$get_status" != "200" ]; then
  echo "FAIL: GET /api/canary returned $get_status (expected 200)" >&2
  cat /tmp/smoke-persistence-get.json >&2 || true
  exit 1
fi

latest_token=$(jq -r '.latest // empty' /tmp/smoke-persistence-get.json)
latest_total=$(jq -r '.total // empty' /tmp/smoke-persistence-get.json)

if [ "$latest_token" != "$written_token" ]; then
  echo "FAIL: latest canary token after restart ($latest_token) does not match the token written before restart ($written_token) - data did NOT persist" >&2
  exit 1
fi

if [ "$latest_total" != "$written_total" ]; then
  echo "FAIL: canary row count after restart ($latest_total) does not match count before restart ($written_total) - data did NOT persist" >&2
  exit 1
fi

echo "PASS: canary token ($latest_token) and count ($latest_total) survived a volume-preserving down/up cycle"
echo "==> smoke-persistence.sh: ALL CHECKS PASSED (INFRA-03/D-08)"
