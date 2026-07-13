/**
 * Analytics endpoints (TRACK-04/05, D-10) — the read side of Phase 6's
 * click-tracking feature.
 *
 * `analyticsRoute(prisma, auth)` is a Fastify-plugin FACTORY — mirrors
 * `routes/links.ts`'s `linksRoute(prisma, auth)` pattern exactly, so
 * production wires `db.ts`'s singleton + `lib/auth.ts`'s default `auth`
 * export, while tests wire the SAME transaction-wrapped Prisma client
 * `test/setupFileEach.ts` uses.
 *
 * `GET /api/links/:id/analytics` reuses `routes/links.ts`'s
 * `resolveOwnedLink` IDOR shape VERBATIM (scopedDomainIds ->
 * `link.findFirst({ domainId: { in: domainIds } })`) rather than a fresh
 * ad-hoc ownership check (RESEARCH ASVS V4 note, T-06-IDOR) — 404 for both
 * "no such link" and "link exists but outside the caller's scope", so a
 * caller can never distinguish the two (no existence oracle, matching
 * `resolveOwnedLink`'s own established discipline).
 *
 * `GET /api/analytics` is session-gated and scoped to
 * `scopedDomainIds(prisma, userId)` — the caller's OWN domains, never the
 * whole instance (T-06-GLOBALSCOPE). This is intentionally NOT a no-op
 * auth check: it narrows to exactly the domains the caller has ANY
 * membership on. Full member-ROLE-scoped visibility enforcement (e.g. a
 * "member" seeing less than an "owner" on the same domain) plus the
 * corresponding denial-test suite are deferred to Phase 9 (TEAM-06) — an
 * intentional, documented gap, not an oversight (06-CONTEXT.md deferred
 * section).
 */
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Link, PrismaClient } from "../generated/prisma/client.js";
import type { createAuth } from "../lib/auth.js";
import { getGlobalAnalytics, getLinkAnalytics } from "../lib/analytics.js";
import { scopedDomainIds } from "../lib/authorization.js";

type Auth = ReturnType<typeof createAuth>;

/** Resolves the caller's user id from the session cookie, or `undefined`. Mirrors routes/links.ts. */
async function resolveUserId(auth: Auth, request: FastifyRequest): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user?.id;
}

/**
 * The IDOR guard (T-06-IDOR) — identical shape to `routes/links.ts`'s
 * `resolveOwnedLink`: `scopedDomainIds` always runs first regardless of
 * whether the Link even exists, so "not found" and "forbidden" cost the
 * same query count (WR-04 timing discipline) and return the same `null`.
 */
async function resolveOwnedLink(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<Link | null> {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.link.findFirst({ where: { id, domainId: { in: domainIds } } });
}

export function analyticsRoute(prisma: PrismaClient, auth: Auth) {
  return async function registerAnalyticsRoute(app: FastifyInstance): Promise<void> {
    // GET /api/links/:id/analytics (TRACK-04) — IDOR-guarded per-link
    // analytics, same 404-for-both-not-found-and-forbidden shape as
    // GET /api/links/:id.
    app.get(
      "/api/links/:id/analytics",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id: string };
        const link = await resolveOwnedLink(prisma, userId, id);
        if (!link) return reply.code(404).send({ error: "Not found" });

        return reply.send(await getLinkAnalytics(prisma, id));
      },
    );

    // GET /api/analytics (TRACK-05) — session-gated, scoped to the
    // caller's own domains (scopedDomainIds), never the whole instance.
    app.get("/api/analytics", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const domainIds = await scopedDomainIds(prisma, userId);
      return reply.send(await getGlobalAnalytics(prisma, domainIds));
    });
  };
}
