/**
 * Mounts better-auth's `/api/auth/*` catch-all (AUTH-01..04, D-01, RESEARCH
 * Pattern 1, Pitfall 5).
 *
 * `authRoute(auth)` is a Fastify-plugin FACTORY (not a plugin itself) —
 * mirrors `routes/canary.ts`'s `canaryRoute(prisma)` pattern — so the
 * caller supplies which `auth` instance (`lib/auth.ts`'s `createAuth`
 * output) to forward to: production wires `db.ts`'s singleton (`app.ts`'s
 * default path), while tests wire an instance bound to the SAME
 * transaction-wrapped Prisma client `test/setupFileEach.ts` uses (see
 * `lib/auth.ts`'s header comment for why this is required, not optional).
 *
 * Converts Fastify's Node-style request into a Fetch API `Request`
 * (`fromNodeHeaders` from `better-auth/node`) and forwards the Fetch API
 * `Response` back onto the Fastify reply (status + ALL headers, especially
 * `Set-Cookie`). Deliberately does NOT use `toNodeHandler` + `reply.hijack()`
 * — hijacking bypasses Fastify's response lifecycle and silently breaks
 * `@fastify/helmet`'s header injection on exactly the surface D-07 mandates
 * helmet protect (RESEARCH Anti-Patterns).
 *
 * Registered directly on `app` (NOT nested inside app.ts's `{ prefix: "/api"
 * }` scope that wraps `canaryRoute`) because this route's own `url` strings
 * already include the full `/api/auth/...` path (matching RESEARCH Pattern
 * 1's exact example verbatim) — nesting it inside a second `/api`-prefixed
 * scope would double the prefix to `/api/api/auth/*` and 404 every request.
 * MUST be registered before `registerStatic()`/`setNotFoundHandler` in
 * `app.ts` so the SPA fallback never shadows it (Pitfall 5).
 *
 * The tight per-route rate limit (`MAGIC_LINK_RATE_LIMIT`, plugins/rateLimit
 * .ts, D-07 Pitfall 3) is applied via a SEPARATE, more specific static route
 * for `POST /api/auth/sign-in/magic-link` registered ahead of the general
 * `/api/auth/*` wildcard — Fastify's router (find-my-way) always prefers a
 * matching static route over a wildcard, so this affects only the
 * magic-link request endpoint, not every other better-auth endpoint sharing
 * the catch-all (get-session, sign-out, etc.), which stay under the
 * permissive global default.
 */
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { createAuth } from "../lib/auth.js";
import { MAGIC_LINK_RATE_LIMIT } from "../plugins/rateLimit.js";

type Auth = ReturnType<typeof createAuth>;

function forwardToAuthHandler(auth: Auth) {
  return async function handler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const headers = fromNodeHeaders(request.headers);
    const hasJsonBody =
      request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined;

    const req = new Request(url.toString(), {
      method: request.method,
      headers,
      ...(hasJsonBody ? { body: JSON.stringify(request.body) } : {}),
    });

    const response = await auth.handler(req);

    reply.status(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(response.body ? await response.text() : null);
  };
}

export function authRoute(auth: Auth) {
  return async function registerAuthRoute(app: FastifyInstance): Promise<void> {
    const handler = forwardToAuthHandler(auth);

    // Tight per-route rate limit specifically on the magic-link request
    // endpoint (D-07, Pitfall 3) — registered before the general catch-all
    // so Fastify's router matches this more specific static path first.
    app.route({
      method: ["POST"],
      url: "/api/auth/sign-in/magic-link",
      config: { rateLimit: MAGIC_LINK_RATE_LIMIT },
      handler,
    });

    app.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      handler,
    });
  };
}
