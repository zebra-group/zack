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
 * (`domainId`/`targetUrl`/`slug`/`title` plus, since Phase 5, the raw
 * `password`/`expiresAt`/`forwardQuery` fields — never a hash) before ever
 * reaching `createLink` — this closes the mass-assignment vector
 * (T-04-MASS/T-05-MASS-ASSIGN): a client cannot set
 * `id`/`createdBy`/`createdAt`/a pre-hashed `passwordHash` by including
 * them in the JSON body, since `createLink`'s own `validateLinkInput` only
 * ever reads the allowlisted fields off `parsed.data`, never
 * `request.body` itself.
 */
import type { ImportCommitResult, ImportPreviewResult } from "@zack/shared";
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
import { scopedDomainIds } from "../lib/authorization.js";
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
  // Phase 5 (D-02/D-03/D-12, T-05-MASS): password/expiresAt/forwardQuery
  // are allowlisted here too — passwordHash is NEVER a client-settable
  // field name, only the raw plaintext password, hashed inside
  // createLink's validateLinkInput core (lib/links.ts).
  password: z.string().optional(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  forwardQuery: z.boolean().optional(),
  // Phase 6 (TRACK-01/D-15, T-06-MASS): a plain optional boolean, mirrors
  // forwardQuery exactly. lifetimeClicks is intentionally NEVER allowlisted
  // here — it is server-owned (D-13) and must stay client-unsettable.
  trackingEnabled: z.boolean().optional(),
  // Phase 8 (D-08-01/D-08-05, T-08-MASS): UTM trio + OG trio — plain
  // optional strings on create (there is no "clear" case yet, nothing to
  // clear on a brand-new row). Length/scheme validation happens inside
  // createLink's validateLinkInput core (lib/links.ts), not here — this
  // schema only bounds the client-settable SHAPE (string vs. not).
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  ogTitle: z.string().optional(),
  ogDescription: z.string().optional(),
  ogImageUrl: z.string().optional(),
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
  // Phase 5 (D-02/D-03/D-12): keep/clear/set semantics — omitted keeps the
  // current value, explicit `null` clears (password/expiresAt only),
  // a value sets/replaces. A blank-string password is mapped to "keep"
  // (undefined) in the PATCH handler below, following the same
  // omitted-vs-explicit-null discipline as `title`'s WR-02 fix.
  password: z.string().nullable().optional(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  forwardQuery: z.boolean().optional(),
  // Phase 6 (TRACK-01/D-15): omitted keeps the current value — same
  // no-tri-state shape as forwardQuery, no "clear" semantic needed.
  trackingEnabled: z.boolean().optional(),
  // Phase 8 (D-08-01..05, T-08-MASS): keep/clear/set — omitted keeps the
  // current value, explicit `null` clears it, a value sets/replaces it.
  // UNLIKE `password` above: an explicit EMPTY STRING here also means
  // CLEAR (D-08-05) — the PATCH handler below must NOT collapse "" to
  // undefined for these six, the way it does for `password`.
  utmSource: z.string().nullable().optional(),
  utmMedium: z.string().nullable().optional(),
  utmCampaign: z.string().nullable().optional(),
  ogTitle: z.string().nullable().optional(),
  ogDescription: z.string().nullable().optional(),
  ogImageUrl: z.string().nullable().optional(),
});

/**
 * IN-02 fix (04-REVIEW.md): an explicit ceiling on the raw CSV text length,
 * rather than relying on Fastify's un-stated implicit `bodyLimit` default
 * (1 MiB) as the only real constraint on this resource-sensitive endpoint
 * (CSV parsing + up to `MAX_IMPORT_ROWS` DB round-trips). Sized comfortably
 * above a realistic `MAX_IMPORT_ROWS`-row CSV: 500 rows x a generous
 * ~2.3 KB/row (2048-char max targetUrl + slug + hostname + delimiters) is
 * ~1.15 MB; this leaves headroom while staying well inside the explicit
 * `bodyLimit` set on the Fastify instance (app.ts) so the JSON envelope
 * (this field plus `defaultDomainId`) never itself trips that ceiling.
 */
const CSV_MAX_LENGTH = 1_800_000;

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
  csv: z.string().min(1).max(CSV_MAX_LENGTH),
  defaultDomainId: z.string().optional(),
});

/** True for the `Error` `runImport` throws when a CSV exceeds `MAX_IMPORT_ROWS` (lib/links.ts). */
function isImportRowLimitError(err: unknown): err is Error {
  return err instanceof Error && err.message.includes(`${MAX_IMPORT_ROWS} row limit`);
}

/** True for the `Error` `runImport` throws when the CSV header doesn't match EXPECTED_CSV_COLUMNS (IN-04, lib/links.ts). */
function isImportHeaderMismatchError(err: unknown): err is Error {
  return err instanceof Error && err.message.startsWith("CSV header does not match");
}

/** Maps a `LinkErrorCode` (lib/links.ts) to the HTTP status the route returns. */
function statusForLinkError(error: LinkErrorCode): number {
  switch (error) {
    case "UNAUTHORIZED_DOMAIN":
    case "DOMAIN_NOT_ACTIVE":
      return 403;
    case "INVALID_TARGET_URL":
    case "SLUG_RESERVED":
    case "SLUG_INVALID_SHAPE":
      return 400;
    case "SLUG_TAKEN":
      return 409;
    case "SLUG_GENERATION_EXHAUSTED":
      return 503;
    // Phase 8 (D-08-04/D-08-05): all five UTM/OG validation failures are
    // client input errors — same bucket as INVALID_TARGET_URL above.
    case "UTM_VALUE_TOO_LONG":
    case "OG_TITLE_TOO_LONG":
    case "OG_DESCRIPTION_TOO_LONG":
    case "OG_IMAGE_URL_TOO_LONG":
    case "OG_IMAGE_URL_INVALID":
      return 400;
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
 * domain), a Link's `:id` is one join away from its domain, so a plain
 * `findUnique` by id alone is not enough to prove access.
 *
 * WR-04 fix (04-REVIEW.md): the previous two-step implementation
 * (`link.findUnique` then, ONLY on a hit, a second `requireDomainAccess`
 * query) did strictly MORE database work on the "exists but forbidden"
 * branch than the "does not exist" branch — a measurable timing/query-count
 * side channel a caller could use to distinguish "an id I can't access"
 * from "an id that doesn't exist" via statistical timing analysis,
 * defeating the no-existence-oracle goal below. This version performs
 * EXACTLY the same two queries (`scopedDomainIds` -> `domainMembership.
 * findMany`, then `link.findFirst`) on every outcome — found, not-found,
 * and forbidden all cost identically, because the membership lookup always
 * runs FIRST regardless of whether the Link even exists. `scopedDomainIds`
 * returns every domain the caller has ANY membership on (member/admin/
 * owner) — equivalent to "member+ access" here since every Link route
 * requires only `"member"` (the lowest rank), so this is not a
 * relaxation of the access rule, just a reshaping of the query.
 *
 * Returns `null` for BOTH "no such Link" AND "Link exists but outside the
 * caller's accessible domains" — the caller must never be able to
 * distinguish the two (no existence oracle), matching this codebase's
 * `tlsCheck.ts`-established information-disclosure discipline.
 */
async function resolveOwnedLink(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<Link | null> {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.link.findFirst({ where: { id, domainId: { in: domainIds } } });
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

      // WR-01 fix (04-REVIEW.md): an OMITTED slug means "keep current" —
      // but an explicitly-provided empty/whitespace-only slug must NEVER
      // silently regenerate a brand-new random slug (undermining D-04's
      // "a slug change is always visible/warned-about" guarantee). Reject
      // it as a validation error instead of letting it fall into
      // resolveSlug's blank-slug auto-generation branch (lib/links.ts).
      if (parsed.data.slug !== undefined && parsed.data.slug.trim().length === 0) {
        return reply.code(400).send({ error: "SLUG_INVALID_SHAPE" });
      }
      const requestedSlug = parsed.data.slug?.trim();

      // Phase 5 (D-02): a blank/empty-string password means "no change"
      // (mirrors the slug WR-01 discipline above) — only an explicit
      // `null` clears an existing password. Collapse "" to `undefined`
      // here so `updateLink`'s own undefined-vs-null distinction
      // (lib/links.ts's derivePasswordHash) receives the correct signal.
      const requestedPassword = parsed.data.password === "" ? undefined : parsed.data.password;

      const result = await updateLink(prisma, id, {
        userId,
        domainId: link.domainId,
        targetUrl: parsed.data.targetUrl ?? link.targetUrl,
        slug: requestedSlug ?? link.slug,
        // WR-02 fix (04-REVIEW.md): `title: null` must actually CLEAR the
        // title, not collapse to "no change" — `null ?? undefined` used to
        // evaluate to `undefined` (Prisma's "omit this field" signal), so
        // an explicit `{ "title": null }` PATCH silently did nothing. Pass
        // `null` through untouched when explicitly provided; only fall
        // back to the link's current value when `title` was OMITTED
        // entirely (`parsed.data.title === undefined`).
        title: parsed.data.title !== undefined ? parsed.data.title : (link.title ?? undefined),
        // Phase 5 (D-02/D-03/D-12): pass the allowlisted fields straight
        // through untouched — undefined (omitted) means "keep", explicit
        // null means "clear" (password/expiresAt), a value means "set".
        password: requestedPassword,
        expiresAt: parsed.data.expiresAt,
        forwardQuery: parsed.data.forwardQuery,
        trackingEnabled: parsed.data.trackingEnabled,
        // Phase 8 (D-08-01..05): pass all six straight through from
        // parsed.data UNTOUCHED — no `??` fallback to the stored value
        // (that would destroy the explicit-null/explicit-empty-string
        // CLEAR signal, mirroring the WR-02 discipline already applied to
        // `title` above). `deriveMetaField` (lib/links.ts) is the single
        // place that interprets undefined/null/""/value.
        utmSource: parsed.data.utmSource,
        utmMedium: parsed.data.utmMedium,
        utmCampaign: parsed.data.utmCampaign,
        ogTitle: parsed.data.ogTitle,
        ogDescription: parsed.data.ogDescription,
        ogImageUrl: parsed.data.ogImageUrl,
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
          if (isImportRowLimitError(err) || isImportHeaderMismatchError(err)) {
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
            // WR-10 fix (04-REVIEW.md): surface a partial/aborted commit
            // precisely instead of the caller only ever seeing a bare
            // count with no signal that the CSV wasn't fully processed.
            partial: result.partial ?? false,
          };
          return reply.send(response);
        } catch (err) {
          if (isImportRowLimitError(err) || isImportHeaderMismatchError(err)) {
            return reply.code(400).send({ error: err.message });
          }
          throw err;
        }
      },
    });
  };
}
