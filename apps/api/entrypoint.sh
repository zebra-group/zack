#!/bin/sh
# Container entrypoint (D-05, INFRA-01).
#
# Runs `prisma migrate deploy` against DATABASE_URL every time the `app`
# container starts, BEFORE the server begins listening - this is the only
# migration step Kurzly ever runs, and it never happens as a Dockerfile
# RUN step (01-RESEARCH.md Pitfall 4). `migrate deploy` is forward-only and
# non-destructive: it never resets or drops data, so it is safe to run on
# every restart, including against a database that already has data
# (INFRA-03 persistence).
set -e

echo "Running prisma migrate deploy..."
node_modules/.bin/prisma migrate deploy

echo "Starting server..."
exec node dist/server.js
