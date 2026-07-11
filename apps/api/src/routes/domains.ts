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
 *
 * `POST /:id/verify`, `DELETE /:id`, and `GET /:id/instructions` (03-02,
 * DOMAIN-02/DOMAIN-04) all go through `requireDomainAccess(prisma, userId,
 * id, "admin")` — deny-by-default per D-04: a `member`-role caller or an
 * unknown user/domain pair is rejected with 403, never implicitly allowed.
 * `POST /:id/verify` calls `verifyDomain` with the INJECTED `dnsResolver`
 * (default `nodeDnsResolver`, threaded through from `buildApp({
 * dnsResolver })`) so tests drive deterministic status transitions without
 * ever touching live DNS (RESEARCH Environment Availability).
 */
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { DOMAIN_VERIFICATION_DEFAULTS } from "../env.js";
import type { Domain, PrismaClient } from "../generated/prisma/client.js";
import { ForbiddenError, requireDomainAccess, scopedDomainIds } from "../lib/authorization.js";
import type { createAuth } from "../lib/auth.js";
import type { DnsResolver } from "../lib/dnsClient.js";
import { nodeDnsResolver, verifyDomain } from "../lib/dnsClient.js";
import { normalizeHostname } from "../lib/hostname.js";
import { DOMAIN_CREATE_RATE_LIMIT, VERIFY_RATE_LIMIT } from "../plugins/rateLimit.js";

type Auth = ReturnType<typeof createAuth>;

/**
 * CR-01: normalize (trim + lowercase + strip a trailing dot, via the SAME
 * `normalizeHostname()` `resolveActiveDomainByHost` uses) BEFORE the
 * uniqueness pre-check and BEFORE persistence — closes both the
 * DNS-ownership-proof bypass (an unrelated user registering a case/dot
 * variant of an already-verified hostname) and the "verified but
 * permanently unreachable" trap (a non-lowercase stored hostname the
 * always-lowercasing read-side guard could never match).
 */
const createDomainSchema = z.object({
  hostname: z
    .string()
    .min(1)
    .max(255)
    .transform((v) => normalizeHostname(v)),
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
 * imported after boot-time validation" convention, with the SAME fallback
 * constants `env.ts`'s Zod defaults reference (IN-02 — single source of
 * truth for the two literals), so an unset ENV var behaves identically
 * whether or not `loadEnv()` ran first (e.g. under Vitest).
 */
function computeVerificationTarget(type: "subdomain" | "apex"): string {
  return type === "subdomain"
    ? (process.env.CNAME_TARGET ?? DOMAIN_VERIFICATION_DEFAULTS.CNAME_TARGET)
    : (process.env.A_RECORD_IP ?? DOMAIN_VERIFICATION_DEFAULTS.A_RECORD_IP);
}

/**
 * Builds the per-domain DNS setup instructions (DOMAIN-04, D-02) — a CNAME
 * line for a subdomain, an A line (plus an ALIAS alternative) for an apex
 * domain. Formats match 03-UI-SPEC.md's code-block copy.
 */
function toInstructions(domain: Pick<Domain, "hostname" | "type" | "verificationTarget">) {
  const isSubdomain = domain.type === "subdomain";
  return {
    hostname: domain.hostname,
    type: domain.type,
    verificationTarget: domain.verificationTarget,
    instructions: isSubdomain
      ? `${domain.hostname}.  300  IN  CNAME  ${domain.verificationTarget}.`
      : `${domain.hostname}.  300  IN  A  ${domain.verificationTarget}`,
    alternativeForApex: isSubdomain
      ? null
      : `${domain.hostname}.  300  IN  ALIAS  ${domain.verificationTarget}.`,
  };
}

export function domainsRoute(
  prisma: PrismaClient,
  auth: Auth,
  dnsResolver: DnsResolver = nodeDnsResolver,
) {
  return async function registerDomainsRoute(app: FastifyInstance): Promise<void> {
    // IN-01: dedicated per-route rate-limit override (mirrors
    // VERIFY_RATE_LIMIT/TLS_CHECK_RATE_LIMIT's established pattern) —
    // without it, creation only inherited the permissive 100-req/15-min
    // global default, letting an authenticated-but-careless client create
    // up to 100 pending Domain rows in that window.
    app.route({
      method: "POST",
      url: "/api/domains",
      config: { rateLimit: DOMAIN_CREATE_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
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
            // `hostname` is already normalized by createDomainSchema
            // (CR-01), so this pre-check and the create below both operate
            // on the canonical form — a case/dot variant of an existing
            // hostname collides here exactly like an exact duplicate would.
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
      },
    });

    app.get("/api/domains", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const domainIds = await scopedDomainIds(prisma, userId);
      const domains = await prisma.domain.findMany({ where: { id: { in: domainIds } } });
      return reply.send(domains.map(toDomainDto));
    });

    // POST /api/domains/:id/verify — on-demand DNS check (DOMAIN-02, D-03).
    // Admin+-gated (D-04); rate-limited (RESEARCH Pitfall 4) since a "Jetzt
    // prüfen" click is lower-risk than magic-link but still needs a per-route
    // guard against DNS-amplification/write-load abuse.
    app.route({
      method: "POST",
      url: "/api/domains/:id/verify",
      config: { rateLimit: VERIFY_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id: string };
        try {
          await requireDomainAccess(prisma, userId, id, "admin");
        } catch (err) {
          if (err instanceof ForbiddenError) return reply.code(403).send({ error: "Forbidden" });
          throw err;
        }

        const domain = await prisma.domain.findUniqueOrThrow({ where: { id } });
        const result = await verifyDomain(
          domain.hostname,
          domain.type,
          domain.verificationTarget,
          dnsResolver,
        );

        const updated = await prisma.domain.update({
          where: { id },
          data: {
            status: result.verified ? "active" : "failed",
            verifiedAt: result.verified ? new Date() : domain.verifiedAt,
            lastCheckedAt: new Date(),
            lastCheckError: result.verified ? null : (result.error ?? "DNS record not found"),
          },
        });

        return reply.send(toDomainDto(updated));
      },
    });

    // DELETE /api/domains/:id — admin+-gated (D-04).
    app.delete("/api/domains/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = request.params as { id: string };
      try {
        await requireDomainAccess(prisma, userId, id, "admin");
      } catch (err) {
        if (err instanceof ForbiddenError) return reply.code(403).send({ error: "Forbidden" });
        throw err;
      }

      await prisma.domain.delete({ where: { id } });
      return reply.code(204).send();
    });

    // GET /api/domains/:id/instructions — per-domain DNS setup guide
    // (DOMAIN-04); admin+-gated (D-04) — same trust boundary as verify/delete,
    // since it reveals the operator's exact CNAME/A target for this domain.
    app.get(
      "/api/domains/:id/instructions",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id: string };
        try {
          await requireDomainAccess(prisma, userId, id, "admin");
        } catch (err) {
          if (err instanceof ForbiddenError) return reply.code(403).send({ error: "Forbidden" });
          throw err;
        }

        const domain = await prisma.domain.findUniqueOrThrow({ where: { id } });
        return reply.send(toInstructions(domain));
      },
    );
  };
}
