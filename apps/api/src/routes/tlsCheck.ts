/**
 * TLS-check ask endpoint (D-01, DOMAIN-03 reformulated, Pattern 3,
 * T-03-04, T-03-05b) — the operator-delegated status gate a reverse proxy
 * (e.g. Caddy's `on_demand_tls.ask`) queries directly, BEFORE issuing a
 * Let's Encrypt certificate for a hostname it doesn't already have a
 * static site block for.
 *
 * `tlsCheckRoute(prisma)` is a Fastify-plugin FACTORY, mirroring
 * `canaryRoute(prisma)` — no session/cookie is read or required, since the
 * caller here is the operator's own reverse proxy, not a browser.
 *
 * Reads the hostname to check from the `?domain=` QUERY param only — Caddy
 * appends this automatically from the TLS SNI on every `ask` call
 * (Pattern 3) — NEVER from `request.hostname` or a spoofable
 * `X-Forwarded-Host` header (Pitfall 1, T-03-02). The actual match/deny
 * decision is fully delegated to `resolveActiveDomainByHost` (Pattern 4).
 *
 * Response contract matches Caddy's `ask` expectations exactly: 200 with an
 * EMPTY body means "issue a cert for this hostname", any non-2xx (404 here)
 * means "refuse" — no response body in either branch, and no distinguishing
 * detail between "unregistered" vs "registered but not active" beyond the
 * status code itself (T-03-04, Information Disclosure mitigation).
 *
 * Deliberately a single indexed `findUnique` with no joins/external calls
 * (via `resolveActiveDomainByHost`) — this endpoint sits directly on the
 * TLS handshake critical path for any hostname's first connection
 * (Pitfall 3), so latency here must stay in the low milliseconds.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { resolveActiveDomainByHost } from "../lib/domainResolution.js";
import { TLS_CHECK_RATE_LIMIT } from "../plugins/rateLimit.js";

export function tlsCheckRoute(prisma: PrismaClient) {
  return async function registerTlsCheckRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/tls-check",
      config: { rateLimit: TLS_CHECK_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        // WR-01: `request.query` is an unchecked type assertion, not a
        // runtime guarantee — Fastify's default query-string parser turns a
        // repeated `?domain=` key into an array, which has no
        // `.toLowerCase()` and would otherwise throw a TypeError deep
        // inside `resolveActiveDomainByHost` (a 500 on this unauthenticated,
        // internet-facing TLS-handshake-critical-path endpoint). Coercing
        // anything that isn't a plain string to `undefined` routes a
        // missing/duplicate-key/non-string `?domain=` through the SAME
        // deny-by-default `undefined` branch `resolveActiveDomainByHost`
        // already handles, giving a clean 404 instead.
        const rawDomain = (request.query as Record<string, unknown> | undefined)?.domain;
        const domain = typeof rawDomain === "string" ? rawDomain : undefined;
        const resolved = await resolveActiveDomainByHost(prisma, domain);

        if (!resolved) return reply.code(404).send();
        return reply.code(200).send();
      },
    });
  };
}
