# Standalone mock OIDC Identity Provider image for the E2E-only
# docker-compose.e2e.yml overlay (13-01-PLAN.md). Deliberately NOT a
# pnpm-workspace member -- built as its own isolated image, mirroring how
# `db`/`mailpit` are plain services with zero shared code with the rest of
# the monorepo.
FROM node:24-alpine

WORKDIR /app

# curl is required so docker-compose.e2e.yml's healthcheck can probe the
# discovery endpoint from inside this container (no dependency on a host
# tool being present).
RUN apk add --no-cache curl

COPY package.json ./
# No lockfile for this isolated test fixture -- a single pinned dependency
# (oidc-provider@9.10.0, vetted in 13-01-PLAN.md Task 1's package-legitimacy
# checkpoint) with no need for a workspace-wide install.
RUN npm install

COPY server.mjs ./

EXPOSE 9000

CMD ["node", "server.mjs"]
