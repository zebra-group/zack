/**
 * Link create + list (LINK-01/02/03, D-01/D-02/D-03).
 *
 * `linksRoute(prisma, auth)` is a Fastify-plugin FACTORY — mirrors
 * `routes/domains.ts`'s `domainsRoute(prisma, auth)` pattern exactly, so
 * production wires `db.ts`'s singleton + `lib/auth.ts`'s default `auth`
 * export (app.ts's default path), while tests wire the SAME
 * transaction-wrapped Prisma client `test/setupFileEach.ts` uses.
 *
 * The route layer NEVER inserts or updates a Link directly — every write
 * delegates to `lib/links.ts`'s `createLink` (the D-01 sole insert site).
 * The request body is parsed through an explicit Zod allowlist schema
 * (`domainId`/`targetUrl`/`slug`/`title` only) before ever reaching
 * `createLink` — this closes the mass-assignment vector (T-04-MASS): a
 * client cannot set `id`/`createdBy`/`createdAt` by including them in the
 * JSON body, since `createLink`'s own `validateLinkInput` only ever reads
 * the allowlisted fields off `parsed.data`, never `request.body` itself.
 */
import type { ImportCommitResult, ImportPreviewResult } from "@kurzly/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Link, PrismaClient } from "../generated/prisma/client.js";
import type { createAuth } from "../lib/auth.js";
import {
  commitImport,
  createLink,
  type LinkErrorCode,
  MAX_IMPORT_ROWS,
  previewImport,
  toLinkDto,
  updateLink,
} from "../lib/links.js";
import { ForbiddenError, requireDomainAccess, scopedDomainIds } from "../lib/authorization.js";
import { LINK_CREATE_RATE_LIMIT, LINK_IMPORT_RATE_LIMIT } from "../plugins/rateLimit.js";

type Auth = ReturnType<typeof createAuth>;

/**
 * Request-body allowlist (T-04-MASS) — `request.body` is NEVER passed
 * straight to `createLink`/Prisma; only these four fields ever cross the
 * boundary. `slug`/`title` are optional (blank slug -> auto-generate,
 * per D-02).
 */
const createLinkSchema = z.object({
  domainId: z.string().min(1),
  targetUrl: z.string().min(1),
  slug: z.string().optional(),
  title: z.string().max(200).optional(),
});

/**
 * PATCH request-body allowlist (D-04, T-04-MASS) — deliberately excludes
 * `domainId`/`createdBy`/`id`: the domain a Link belongs to is NOT
 * editable via this route (LINK-06 scope), and a client can never re-home
 * a Link to another domain or spoof its creator via edit.
 */
const updateLinkSchema = z.object({
  targetUrl: z.string().min(1).optional(),
  slug: z.string().optional(),
  title: z.string().max(200).nullable().optional(),
});

/**
 * `POST /api/links/import/{preview,commit}` request-body allowlist
 * (LINK-08, D-05, T-04-MASS) — raw CSV text (read client-side via
 * `FileReader.readAsText()`) plus an optional fallback domain for rows
 * whose `domain` column is blank. `defaultDomainId` does NOT itself grant
 * access to that domain — every row (default or explicit) still passes
 * through `validateLinkInput`'s `requireDomainAccess` inside
 * `runImport` (lib/links.ts).
 */
const importCsvSchema = z.object({
  csv: z.string().min(1),
  defaultDomainId: z.string().optional(),
});

/** True for the `Error` `runImport` throws when a CSV exceeds `MAX_IMPORT_ROWS` (lib/links.ts). */
function isImportRowLimitError(err: unknown): err is Error {
  return err instanceof Error && err.message.includes(`${MAX_IMPORT_ROWS} row limit`);
}

/** Maps a `LinkErrorCode` (lib/links.ts) to the HTTP status the route returns. */
function statusForLinkError(error: LinkErrorCode): number {
  switch (error) {
    case "UNAUTHORIZED_DOMAIN":
      return 403;
    case "INVALID_TARGET_URL":
    case "SLUG_RESERVED":
      return 400;
    case "SLUG_TAKEN":
      return 409;
    case "SLUG_GENERATION_EXHAUSTED":
      return 503;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

/** Resolves the caller's user id from the session cookie, or `undefined`. Mirrors routes/domains.ts. */
async function resolveUserId(auth: Auth, request: FastifyRequest): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user?.id;
}

/**
 * The IDOR guard (RESEARCH Pitfall 4, T-04-IDOR) every Link-by-ID route
 * must run before any read/write: unlike Domain routes (where `:id` IS the
 * domain), a Link's `:id` is one join away from its domain, so
 * `requireDomainAccess` alone is not enough — we must first `findUnique`
 * the Link to learn its `domainId`. Returns `null` for BOTH "no such
 * Link" AND "Link exists but the caller lacks member+ access to its
 * domain" — the caller must never be able to distinguish the two (no
 * existence oracle), matching this codebase's `tlsCheck.ts`-established
 * information-disclosure discipline.
 */
async function resolveOwnedLink(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<Link | null> {
  const link = await prisma.link.findUnique({ where: { id } });
  if (!link) return null;

  try {
    await requireDomainAccess(prisma, userId, link.domainId, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return null;
    throw err;
  }

  return link;
}

export function linksRoute(prisma: PrismaClient, auth: Auth) {
  return async function registerLinksRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/links",
      config: { rateLimit: LINK_CREATE_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const parsed = createLinkSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid link data" });
        }

        // The route layer delegates every write to createLink (lib/links.ts)
        // — the D-01 sole insert site. No prisma.link.create call belongs here.
        const result = await createLink(prisma, { userId, ...parsed.data });
        if (!result.ok) {
          return reply.code(statusForLinkError(result.error)).send({ error: result.error });
        }

        return reply.code(201).send(toLinkDto(result.link));
      },
    });

    app.get("/api/links", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { q, domainId: requestedDomainId } = request.query as {
        q?: string;
        domainId?: string;
      };

      const scoped = await scopedDomainIds(prisma, userId);
      // An out-of-scope requested domainId narrows to an empty result set
      // (never falls back to "all scoped domains") — the caller explicitly
      // asked for a domain they cannot see, so [] is correct, not a 403
      // (matches GET /api/domains's existing "scope silently, never leak"
      // convention rather than disclosing which domain IDs exist).
      const domainIdFilter = requestedDomainId
        ? scoped.filter((id) => id === requestedDomainId)
        : scoped;

      const links = await prisma.link.findMany({
        where: {
          domainId: { in: domainIdFilter },
          ...(q && q.length > 0
            ? {
                OR: [
                  { slug: { contains: q, mode: "insensitive" } },
                  { targetUrl: { contains: q, mode: "insensitive" } },
                  { title: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send(links.map(toLinkDto));
    });

    // GET /api/links/:id — detail (LINK-05), IDOR-guarded (T-04-IDOR): the
    // shared resolveOwnedLink helper returns 404 for both not-found and
    // forbidden so a caller can never distinguish the two.
    app.get("/api/links/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = request.params as { id: string };
      const link = await resolveOwnedLink(prisma, userId, id);
      if (!link) return reply.code(404).send({ error: "Not found" });

      return reply.send(toLinkDto(link));
    });

    // DELETE /api/links/:id — delete (LINK-07), same IDOR guard as GET.
    app.delete("/api/links/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = request.params as { id: string };
      const link = await resolveOwnedLink(prisma, userId, id);
      if (!link) return reply.code(404).send({ error: "Not found" });

      await prisma.link.delete({ where: { id } });
      return reply.code(204).send();
    });

    // PATCH /api/links/:id — edit target/title/slug (LINK-06, D-04), same
    // IDOR guard as GET/DELETE. Delegates every write to lib/links.ts's
    // updateLink (the D-01 sole Prisma-Link-update call site) — this route
    // never touches the Link row directly. domainId is deliberately NOT
    // editable (allowlist excludes it); the domain that resolveOwnedLink
    // already authorized against is carried forward unchanged. A field
    // omitted from the body keeps its current persisted value (slug
    // omitted -> re-validates the link's OWN current slug via
    // excludeLinkId, never a false SLUG_TAKEN, per D-04's re-save
    // guarantee).
    app.patch("/api/links/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = request.params as { id: string };
      const link = await resolveOwnedLink(prisma, userId, id);
      if (!link) return reply.code(404).send({ error: "Not found" });

      const parsed = updateLinkSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid link data" });
      }

      const result = await updateLink(prisma, id, {
        userId,
        domainId: link.domainId,
        targetUrl: parsed.data.targetUrl ?? link.targetUrl,
        slug: parsed.data.slug ?? link.slug,
        title:
          parsed.data.title !== undefined ? (parsed.data.title ?? undefined) : (link.title ?? undefined),
      });

      if (!result.ok) {
        if (result.error === "NOT_FOUND") {
          // Cannot occur in practice — resolveOwnedLink already proved the
          // row exists — but keep the branch so the mapping stays total.
          return reply.code(404).send({ error: "Not found" });
        }
        return reply.code(statusForLinkError(result.error)).send({ error: result.error });
      }

      return reply.send(toLinkDto(result.link));
    });

    // POST /api/links/import/preview — CSV bulk-import dry-run (LINK-08,
    // D-01/D-05). Delegates to lib/links.ts's previewImport, which shares
    // its ENTIRE parse+row-loop implementation with commitImport below
    // (runImport, mutate=false) — this route never re-parses or
    // re-validates a row independently, so preview can never drift from
    // commit (RESEARCH Pitfall 2). Zero DB writes.
    app.route({
      method: "POST",
      url: "/api/links/import/preview",
      config: { rateLimit: LINK_IMPORT_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const parsed = importCsvSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid import request" });
        }

        try {
          const result = await previewImport(
            prisma,
            userId,
            parsed.data.csv,
            parsed.data.defaultDomainId,
          );
          const response: ImportPreviewResult = {
            validCount: result.validCount,
            skippedCount: result.skippedCount,
            rows: result.rows,
          };
          return reply.send(response);
        } catch (err) {
          if (isImportRowLimitError(err)) {
            return reply.code(400).send({ error: err.message });
          }
          throw err;
        }
      },
    });

    // POST /api/links/import/commit — CSV bulk-import commit (LINK-08,
    // D-01/D-05). Delegates to lib/links.ts's commitImport (runImport,
    // mutate=true), which calls createLink — the SAME sole insert site
    // POST /api/links uses — row-by-row, SEQUENTIALLY. There is no
    // second/bulk insert path in this handler; every write a caller can
    // trigger here is structurally identical to a manual create.
    app.route({
      method: "POST",
      url: "/api/links/import/commit",
      config: { rateLimit: LINK_IMPORT_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const parsed = importCsvSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid import request" });
        }

        try {
          const result = await commitImport(
            prisma,
            userId,
            parsed.data.csv,
            parsed.data.defaultDomainId,
          );
          const response: ImportCommitResult = {
            importedCount: result.validCount,
            skippedCount: result.skippedCount,
            rows: result.rows,
          };
          return reply.send(response);
        } catch (err) {
          if (isImportRowLimitError(err)) {
            return reply.code(400).send({ error: err.message });
          }
          throw err;
        }
      },
    });
  };
}
