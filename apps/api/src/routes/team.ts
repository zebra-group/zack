/**
 * Team management routes (Phase 9, TEAM-01..05, D-09-02/03/04/05/06/07).
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
 * `PATCH /:id/role`, `PUT /:id/domains`, `DELETE /:id` (Phase 9 Plan 4,
 * TEAM-03/04/05) reuse the SAME admin gate and Zod-allowlist idiom, and map
 * `lib/team.ts`'s typed `TeamErrorCode` results to HTTP status via
 * `statusForTeamError` — mirrors `routes/links.ts`'s `statusForLinkError`
 * mapping style. `request.body` never reaches
 * `changeMemberRole`/`assignMemberDomains`/`removeMember`/Prisma directly,
 * only the Zod-parsed, allowlisted fields (T-09-MUT-MASS).
 *
 * All writes delegate to `lib/team.ts` — this file never calls
 * `prisma.user.create`/`update`/`delete` or `prisma.domainMembership.*`
 * itself.
 */
import { fromNodeHeaders } from "better-auth/node";
import type { TeamErrorCode } from "@zack/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { isAccountAdmin } from "../lib/accountRole.js";
import type { createAuth } from "../lib/auth.js";
import {
  assignMemberDomains,
  changeMemberRole,
  inviteMember,
  listTeamMembers,
  removeMember,
} from "../lib/team.js";
import { MAGIC_LINK_RATE_LIMIT } from "../plugins/rateLimit.js";

type Auth = ReturnType<typeof createAuth>;

/**
 * Maps a `TeamErrorCode` (lib/team.ts) to the HTTP status the route
 * returns — mirrors `routes/links.ts`'s `statusForLinkError`. `NOT_FOUND`:
 * the `:id` does not reference an existing User. `LAST_ADMIN` (D-09-07):
 * the mutation would leave zero admins — refused, nothing changed.
 * `INVALID_DOMAIN`: an assigned `domainId` does not reference an existing
 * Domain.
 */
function statusForTeamError(error: TeamErrorCode): number {
  switch (error) {
    case "NOT_FOUND":
      return 404;
    case "LAST_ADMIN":
      return 409;
    case "CONFLICT":
      // WR-02: a lockout guard hit transaction contention (P2028) — nothing
      // changed and the request is safe to retry.
      return 409;
    case "INVALID_DOMAIN":
      return 400;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

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

/**
 * T-09-MUT-MASS: `PATCH /:id/role` accepts ONLY a fixed two-value enum —
 * no other `User` field (e.g. `emailVerified`, `email`) is ever reachable
 * from this body.
 */
const updateMemberRoleSchema = z.object({
  accountRole: z.enum(["admin", "member"]),
});

/** T-09-MUT-MASS: `PUT /:id/domains` accepts ONLY a plain string array. */
const assignDomainsSchema = z.object({
  domainIds: z.array(z.string()),
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

    // PATCH /api/team/:id/role (TEAM-04, D-09-05/D-09-07) — promote clears
    // the target's domain assignments atomically; demote is refused with
    // LAST_ADMIN if the target is the sole admin.
    app.patch("/api/team/:id/role", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      if (!(await isAccountAdmin(prisma, userId))) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = updateMemberRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid role data" });
      }

      const { id } = request.params as { id: string };
      const result = await changeMemberRole(prisma, id, parsed.data.accountRole);
      if (!result.ok) {
        return reply.code(statusForTeamError(result.error)).send({ error: result.error });
      }

      return reply.send(result.member);
    });

    // PUT /api/team/:id/domains (TEAM-03) — replaces the target's domain
    // set exactly; an unknown domainId is rejected before any write.
    app.put("/api/team/:id/domains", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      if (!(await isAccountAdmin(prisma, userId))) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const parsed = assignDomainsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid domain assignment data" });
      }

      const { id } = request.params as { id: string };
      const result = await assignMemberDomains(prisma, id, parsed.data.domainIds);
      if (!result.ok) {
        return reply.code(statusForTeamError(result.error)).send({ error: result.error });
      }

      return reply.send(result.member);
    });

    // DELETE /api/team/:id (TEAM-05, D-09-06/D-09-07) — removes the User
    // row; their created Links/QR codes survive (schema Cascade/SetNull).
    // Refused with LAST_ADMIN if the target is the sole admin (covers
    // removing one's own account while sole admin — the guard doesn't
    // special-case "self", it applies to the target id regardless of who
    // the caller is).
    app.delete("/api/team/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      if (!(await isAccountAdmin(prisma, userId))) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const { id } = request.params as { id: string };
      const result = await removeMember(prisma, id);
      if (!result.ok) {
        return reply.code(statusForTeamError(result.error)).send({ error: result.error });
      }

      return reply.code(204).send();
    });
  };
}
