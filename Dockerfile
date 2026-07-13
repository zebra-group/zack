# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for Kurzly (D-01 single-image deployment).
#
# Stages:
#   base    - node:24-alpine + pnpm via corepack (shared by build/runtime)
#   build   - installs the full pnpm workspace, generates the Prisma client
#             EXPLICITLY (never relies on the postinstall lifecycle hook -
#             see 01-RESEARCH.md Pitfall 1), builds packages/shared before
#             apps/* (pnpm's topological -r ordering), then prunes to a
#             production-only @kurzly/api deploy directory
#   runtime - the actual shipped image: pruned API + the built Vue SPA
#             copied into the API's public/ dir (single-origin serving),
#             plus the migration-on-start entrypoint
#
# Migrations are NEVER run in a RUN step here (Pitfall 4) - only at
# container start, via entrypoint.sh (D-05).

FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
ENV CI=true
RUN corepack enable

FROM base AS build
WORKDIR /usr/src/app

# Copy the whole workspace (pruned by .dockerignore: no node_modules/.git/.env).
COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Explicit `prisma generate` - do NOT rely on Prisma's postinstall lifecycle
# hook alone; pnpm's allowBuilds gate (pnpm-workspace.yaml) already approves
# it, but this step makes generation unconditional and visible in build logs
# (01-RESEARCH.md Pitfall 1).
# `prisma.config.ts` resolves DATABASE_URL eagerly via env() even for
# `generate` (which never opens a DB connection) - a placeholder value
# unblocks config loading without needing a real database at build time.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    pnpm --filter @kurzly/api exec prisma generate

# Topological build: packages/shared builds before apps/web and apps/api,
# because both declare it as a workspace:* dependency (pnpm resolves the
# dependency graph, not directory order - 01-RESEARCH.md Pitfall 2).
RUN pnpm run -r build

# GeoIP DB bake (Phase 6, D-01/D-02): DB-IP Country Lite .mmdb, downloaded
# and baked into the image at BUILD time only - never a runtime fetch, so
# the image works fully air-gapped/offline out of the box. `curl` is not
# present in node:24-alpine by default (06-RESEARCH.md Pitfall 6).
# GEOIP_DB_PATH (env.ts, D-03) is an operator override for a bind-mounted
# .mmdb - the runtime default below is exactly this build's COPY target,
# no env var needs to be set for the bundled DB to work.
# Attribution (CC-BY 4.0, D-01): a visible "IP Geolocation by DB-IP" link
# back to https://db-ip.com is required wherever results are displayed -
# handled in the dashboard footer/docs, not here.
RUN apk add --no-cache curl \
 && mkdir -p /usr/src/app/geo \
 && curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-$(date +'%Y-%m').mmdb.gz" \
      -o /usr/src/app/geo/dbip-country-lite.mmdb.gz \
 && gunzip /usr/src/app/geo/dbip-country-lite.mmdb.gz

# Prune to a standalone, production-only @kurzly/api directory. `--legacy`
# performs a real content copy (not the injected/symlinked workspace-package
# mode pnpm 10+ defaults to) - required so the pruned output is a
# self-contained directory safe to COPY into the runtime stage.
RUN pnpm deploy --filter=@kurzly/api --prod --legacy /prod/api

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /prod/api

COPY --from=build --chown=node:node /prod/api /prod/api
# Single-image SPA serving (D-01): the built Vue dist/ becomes the API's
# static public/ directory, served by @fastify/static (see plugins/static.ts).
COPY --from=build --chown=node:node /usr/src/app/apps/web/dist /prod/api/public
# GeoIP DB (Phase 6, D-02): lands exactly at lib/geoip.ts's resolveDbPath()
# default (/prod/api/geo/dbip-country-lite.mmdb) - country resolution works
# offline out of the box; the DB refreshes only on image rebuild.
COPY --from=build --chown=node:node /usr/src/app/geo /prod/api/geo
COPY --chown=node:node apps/api/entrypoint.sh /prod/api/entrypoint.sh
RUN chmod +x /prod/api/entrypoint.sh

# Run as the non-root `node` user (built into node:24-alpine — no need to
# create one) so a future RCE-class bug in a dependency handling
# untrusted HTTP input has a materially smaller blast radius (WR-03).
USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/prod/api/entrypoint.sh"]
