/**
 * Team management routes (Phase 9, TEAM-01/TEAM-02, D-09-02/D-09-03/D-09-04).
 *
 * `teamRoute(prisma, auth)` is a Fastify-plugin FACTORY — mirrors
 * `routes/domains.ts`'s `domainsRoute(prisma, auth)` pattern exactly
 * (including `resolveUserId` via `auth.api.getSession` + `fromNodeHeaders`
 * — there is NO `request.session` decorator anywhere in this codebase).
 *
 * Every endpoint here is account-admin-gated (T-09-TEAM-AUTHZ): 401 with no
 * session, 403 for a signed-in non-admin, regardless of what the UI offers.
 * The gate calls `isAccountAdmin(prisma, userId)` (the 09-01 shared
 * primitive) directly — this file does NOT re-derive `accountRole ===
 * "admin"` ad hoc.
 *
 * `POST /api/team/invite` carries `MAGIC_LINK_RATE_LIMIT` (T-09-INVITE-BOMB)
 * since it fundamentally triggers a mail send, same posture as
 * `routes/auth.ts`'s own magic-link request endpoint. Its Zod schema
 * (T-09-INVITE-MASS) is a strict allowlist — `request.body` never reaches
 * `inviteMember`/Prisma directly, only `parsed.data`.
 *
 * All writes delegate to `lib/team.ts`'s `inviteMember` — this file never
 * calls `prisma.user.create` itself.
 */
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { isAccountAdmin } from "../lib/accountRole.js";
import type { createAuth } from "../lib/auth.js";
import { inviteMember, listTeamMembers } from "../lib/team.js";
import { MAGIC_LINK_RATE_LIMIT } from "../plugins/rateLimit.js";

type Auth = ReturnType<typeof createAuth>;

/** Resolves the caller's user id from the session cookie, or `undefined`. */
async function resolveUserId(auth: Auth, request: FastifyRequest): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user?.id;
}

/**
 * T-09-INVITE-MASS: strict allowlist — `accountRole` is a fixed two-value
 * enum (never an arbitrary string), `domainIds` a plain string array; no
 * `id`/`emailVerified`/other User field is ever reachable from this body.
 */
const inviteMemberSchema = z.object({
  email: z.email(),
  accountRole: z.enum(["admin", "member"]),
  domainIds: z.array(z.string()).optional(),
});

export function teamRoute(prisma: PrismaClient, auth: Auth) {
  return async function registerTeamRoute(app: FastifyInstance): Promise<void> {
    app.get("/api/team", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      if (!(await isAccountAdmin(prisma, userId))) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const members = await listTeamMembers(prisma);
      return reply.send(members);
    });

    app.route({
      method: "POST",
      url: "/api/team/invite",
      config: { rateLimit: MAGIC_LINK_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        if (!(await isAccountAdmin(prisma, userId))) {
          return reply.code(403).send({ error: "Forbidden" });
        }

        const parsed = inviteMemberSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid invite data" });
        }

        const result = await inviteMember(prisma, auth, parsed.data);
        if (!result.ok) {
          return reply.code(400).send({ error: result.error });
        }

        return reply.code(201).send(result.member);
      },
    });
  };
}
