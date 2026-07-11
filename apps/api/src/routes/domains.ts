/**
 * Domain registration + list (DOMAIN-01, D-04, RESEARCH Pattern 1/A1).
 *
 * `domainsRoute(prisma, auth)` is a Fastify-plugin FACTORY (not a plugin
 * itself) — mirrors `routes/auth.ts`'s `authRoute(auth)` / `routes/canary
 * .ts`'s `canaryRoute(prisma)` pattern — so the caller supplies which
 * Prisma client + `auth` instance to use: production wires `db.ts`'s
 * singleton and `lib/auth.ts`'s default `auth` export (app.ts's default
 * path), while tests wire the SAME transaction-wrapped Prisma client
 * `test/setupFileEach.ts` uses, plus a `createAuth` instance bound to it
 * (D-09).
 *
 * `POST /api/domains` is gated ONLY on an authenticated (allowlisted)
 * session — NOT `requireDomainAccess` (RESEARCH A1): no `Domain` row, and
 * therefore no `DomainMembership` row, exists yet at creation time, so
 * there is nothing for `requireDomainAccess` to check against. The
 * `Domain` row and its owner `DomainMembership` are created together in a
 * single `prisma.$transaction` — no code path can ever create a Domain
 * without simultaneously establishing its ownership row. Every subsequent
 * domain action (verify/instructions/delete, later plans) goes through
 * `requireDomainAccess`/`scopedDomainIds` as normal (D-04).
 *
 * The caller is resolved via `auth.api.getSession({ headers:
 * fromNodeHeaders(request.headers) })` — there is NO `request.session`
 * decorator anywhere in this codebase (see routes/auth.ts's header
 * comment); reading `request.session` here would be a silent 401-always
 * bug, not a type error, since nothing decorates that property.
 *
 * `GET /api/domains` is scoped via `scopedDomainIds(prisma, userId)` — it
 * only ever returns domains the caller holds ANY membership in, never
 * another tenant's rows (D-04's "member" role is enough to be listed;
 * management actions require admin+, added in later plans).
 */
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Domain, PrismaClient } from "../generated/prisma/client.js";
import { scopedDomainIds } from "../lib/authorization.js";
import type { createAuth } from "../lib/auth.js";

type Auth = ReturnType<typeof createAuth>;

const createDomainSchema = z.object({
  hostname: z.string().min(1).max(255),
  type: z.enum(["subdomain", "apex"]),
});

/**
 * Prisma's known-request-error shape for a unique-constraint violation
 * (P2002) — checked structurally instead of importing
 * `Prisma.PrismaClientKnownRequestError` so this stays resilient to the
 * generated client's internal export layout.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

function toDomainDto(domain: Domain) {
  return {
    id: domain.id,
    hostname: domain.hostname,
    type: domain.type,
    status: domain.status,
    verifiedAt: domain.verifiedAt ? domain.verifiedAt.toISOString() : null,
    lastCheckedAt: domain.lastCheckedAt ? domain.lastCheckedAt.toISOString() : null,
    lastCheckError: domain.lastCheckError,
    createdAt: domain.createdAt.toISOString(),
  };
}

/** Resolves the caller's user id from the session cookie, or `undefined`. */
async function resolveUserId(auth: Auth, request: FastifyRequest): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user?.id;
}

/**
 * Computes the DNS record value a domain owner must point their DNS at,
 * per D-02: CNAME target for subdomains, A-record IP for apex domains.
 * Read directly from `process.env` (not the parsed `loadEnv()` result) —
 * matches `db.ts`/`lib/auth.ts`'s established "this module is only
 * imported after boot-time validation" convention, with the SAME literal
 * fallback `env.ts`'s Zod defaults document, so an unset ENV var behaves
 * identically whether or not `loadEnv()` ran first (e.g. under Vitest).
 */
function computeVerificationTarget(type: "subdomain" | "apex"): string {
  return type === "subdomain"
    ? (process.env.CNAME_TARGET ?? "shortener.kurzly.local")
    : (process.env.A_RECORD_IP ?? "0.0.0.0");
}

export function domainsRoute(prisma: PrismaClient, auth: Auth) {
  return async function registerDomainsRoute(app: FastifyInstance): Promise<void> {
    app.post("/api/domains", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const parsed = createDomainSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid domain data" });
      }
      const { hostname, type } = parsed.data;

      try {
        const domain = await prisma.$transaction(async (tx) => {
          // Pre-check inside the transaction (RESEARCH Pattern 1 code
          // example) so the 409 path never depends on error-message
          // parsing alone — the P2002 catch below is the safety net for
          // the (rare) concurrent-create race this pre-check can't close.
          const existing = await tx.domain.findUnique({ where: { hostname } });
          if (existing) {
            throw Object.assign(new Error("Domain already exists"), { code: "P2002" });
          }

          const created = await tx.domain.create({
            data: {
              hostname,
              type,
              status: "pending",
              verificationTarget: computeVerificationTarget(type),
            },
          });

          // Bootstrap owner membership in the SAME transaction (RESEARCH
          // A1) — no path creates a Domain without its ownership row.
          await tx.domainMembership.create({
            data: { userId, domainId: created.id, role: "owner" },
          });

          return created;
        });

        return reply.code(201).send(toDomainDto(domain));
      } catch (err) {
        if (isUniqueConstraintViolation(err)) {
          return reply.code(409).send({ error: "Domain already exists" });
        }
        throw err;
      }
    });

    app.get("/api/domains", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const domainIds = await scopedDomainIds(prisma, userId);
      const domains = await prisma.domain.findMany({ where: { id: { in: domainIds } } });
      return reply.send(domains.map(toDomainDto));
    });
  };
}
