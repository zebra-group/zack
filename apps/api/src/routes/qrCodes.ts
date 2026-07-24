/**
 * QrCode management routes (QR-01/05/06/07, 07-05-PLAN.md) — CRUD, remap,
 * and on-demand render endpoints.
 *
 * `qrCodesRoute(prisma, auth)` is a Fastify-plugin FACTORY — mirrors
 * `routes/links.ts`'s `linksRoute(prisma, auth)` pattern exactly, so
 * production wires `db.ts`'s singleton + `lib/auth.ts`'s default `auth`
 * export, while tests wire the SAME transaction-wrapped Prisma client
 * `test/setupFileEach.ts` uses.
 *
 * This file NEVER calls `prisma.qrCode.*` directly — every mutation
 * delegates to `lib/qrCodes.ts` (07-04's single-write-path core:
 * `createQrCode`/`updateQrCode`/`remapQrCode`), mirroring `routes/links.ts`'s
 * D-01 discipline. Every render call delegates to `lib/qr.ts` (07-03's
 * shared rendering core) — never a second, ad-hoc renderer.
 *
 * IDOR guard: `resolveOwnedQrCode` copies `routes/links.ts`'s /
 * `routes/analytics.ts`'s `resolveOwnedLink` two-step verbatim
 * (`scopedDomainIds` -> a single `findFirst`, membership-first so
 * found/not-found/forbidden all cost the same query count), joining
 * through the bound Link's `domainId` since a QrCode has no `domainId`
 * column of its own (see schema.prisma's QrCode model comment). Returns
 * `null` for BOTH "no such QrCode" and "QrCode exists but outside the
 * caller's scope" — identical 404 either way, no existence oracle.
 *
 * Mass-assignment guard (T-07-MASS): Zod schemas allowlist ONLY
 * `{variant, linkId, name, color, roundedModules}` (create) and
 * `{name, color, roundedModules, logoEnabled, logoData, targetLinkId}`
 * (update) — `code`, `lifetimeScans`, and an out-of-enum `variant` are
 * never reachable from a request body; only `parsed.data` (never
 * `request.body` itself) ever crosses into `lib/qrCodes.ts`.
 *
 * Color defense-in-depth (SECURITY, 07-05-PLAN.md): `lib/qr.ts`'s renderers
 * already reject a non-hex color at the rendering seam
 * (`InvalidColorError`, closing the SVG `fill=` attribute-injection vector —
 * see that file's header). This route layer ADDITIONALLY validates color
 * against the identical strict hex pattern at the request-body boundary, so
 * a malformed color is rejected with 400 at write time — before it is ever
 * persisted — rather than only surfacing later when a render is attempted.
 * `InvalidColorError`/`InvalidLogoError` are still caught around the render
 * calls below (defense-in-depth for any pre-existing/legacy row) and always
 * map to 400, never an unhandled 500.
 *
 * Remap is a distinct, separately-audited operation from the style-only
 * update (T-07-WRITEPATH, mirrors `packages/shared/src/index.ts`'s
 * `UpdateQrCodeInput` doc comment): a `targetLinkId` in the PATCH body
 * routes the ENTIRE request through `remapQrCode` instead of `updateQrCode`
 * — the two are never combined in one call.
 *
 * `GET .../render.png|svg` (QR-06, Task 2) render from the QrCode's
 * CURRENTLY stored style + resolved payload — a dedicated, generous
 * `QR_RENDER_RATE_LIMIT` bucket (07-RESEARCH.md Open-Question 2) protects
 * this hot path since the QR Studio's live preview debounces at only
 * 300ms per the UI-SPEC, unlike the tighter `QR_CREATE_RATE_LIMIT` bucket
 * applied to `POST /api/qr-codes`. Logo bytes (PATCH body `logoData`) are
 * capped and decoded here, then handed to `updateQrCode` (lib/qrCodes.ts),
 * which is the ONLY place they are ever written — this route never writes
 * bytes to the DB itself.
 *
 * `GET .../remap-history` and `GET /api/qr-codes/:id` (07-04's
 * `getQrRemapHistory` / DTO mapping) are registered here too — 07-07's
 * frontend plan (`depends_on: [07-04, 07-05]`) consumes both through its
 * own `api.ts` client without ever touching a backend file itself, so both
 * must already exist once this plan lands (Rule 2 — auto-added missing
 * critical functionality for that downstream dependency; QR-04 itself is
 * still credited to 07-07, not this plan's `requirements`).
 */
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Domain, Link, PrismaClient, QrCode } from "../generated/prisma/client.js";
import type { createAuth } from "../lib/auth.js";
import { scopedDomainIds } from "../lib/authorization.js";
import { QR_SCAN_PARAM } from "../lib/redirectEngine.js";
import { InvalidColorError, InvalidLogoError, renderQrPng, renderQrSvg, type RenderStyle } from "../lib/qr.js";
import {
  createQrCode,
  getQrRemapHistory,
  remapQrCode,
  statusForQrError,
  toQrCodeDto,
  toQrRemapHistoryEntryDto,
  updateQrCode,
  type QrCodeErrorCode,
} from "../lib/qrCodes.js";
import { QR_CREATE_RATE_LIMIT, QR_RENDER_RATE_LIMIT } from "../plugins/rateLimit.js";

type Auth = ReturnType<typeof createAuth>;

/**
 * A QrCode row plus its bound/current-target Link AND that Link's owning
 * Domain — resolveOwnedQrCode's return shape. The Domain is joined eagerly
 * (not lazily re-queried) because `resolveQrPayload` needs `domain.hostname`
 * to build a static QR's short-link URL on every render.
 */
type QrCodeWithLink = QrCode & { link: Link & { domain: Domain } };

/**
 * Strict CSS hex (`#RGB` or `#RRGGBB`) — deliberately duplicates
 * `lib/qr.ts`'s own (unexported) `HEX_COLOR` pattern as a defense-in-depth
 * Zod gate at the route boundary (SECURITY note, 07-05-PLAN.md): a non-hex
 * color must never even reach `createQrCode`/`updateQrCode`, let alone the
 * SVG `fill="${color}"` interpolation seam those functions' stored value
 * eventually feeds at render time.
 */
const HEX_COLOR_SCHEMA = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid color: expected a #RGB or #RRGGBB hex literal");

/**
 * `POST /api/qr-codes` request-body allowlist (T-07-MASS) — mirrors
 * `routes/links.ts`'s `createLinkSchema`. `code`/`lifetimeScans` are NEVER
 * present here (server-owned, generated inside `createQrCode`); an
 * out-of-enum `variant` fails Zod's `z.enum` check outright (400) rather
 * than silently coercing.
 */
const createQrCodeSchema = z.object({
  variant: z.enum(["static", "dynamic"]),
  linkId: z.string().min(1),
  name: z.string().min(1).max(200),
  color: HEX_COLOR_SCHEMA.optional(),
  roundedModules: z.boolean().optional(),
});

/**
 * IN-02-style ceiling (mirrors `routes/links.ts`'s `CSV_MAX_LENGTH`
 * comment) — `logoData` is a base64/data-URI STRING, so the plan's "max
 * 2 MB pre-decode" cap applies to this string's length, not the decoded
 * byte count. Deliberately sized BELOW `app.ts`'s explicit 2 MiB
 * (2,097,152 byte) global `bodyLimit`, not merely under it: base64
 * inflates ~4/3 over raw bytes, so a request this size still comfortably
 * fits the JSON envelope inside that ceiling, AND — unlike a cap set to
 * exactly 2 MiB — leaves a real, testable gap in which THIS route's own
 * typed 400 (not Fastify's un-typed 413) is what an oversized-logo caller
 * actually receives.
 */
const LOGO_DATA_MAX_LENGTH = 1_900_000;

/**
 * `PATCH /api/qr-codes/:id` request-body allowlist (T-07-MASS,
 * T-07-WRITEPATH) — style-only fields PLUS the one-field remap trigger.
 * `code`/`variant`/`linkId` are deliberately absent, mirroring
 * `packages/shared/src/index.ts`'s `UpdateQrCodeInput` doc comment: a
 * dynamic QR's target is only ever changed via `targetLinkId` routing
 * through `remapQrCode` below, never through the generic style fields.
 */
const updateQrCodeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  color: HEX_COLOR_SCHEMA.optional(),
  roundedModules: z.boolean().optional(),
  logoEnabled: z.boolean().optional(),
  /** Omitted keeps the current logo, `null` clears it, a value sets/replaces it (mirrors UpdateQrCodeInput's tri-state doc comment). */
  logoData: z.string().max(LOGO_DATA_MAX_LENGTH).nullable().optional(),
  /** Present -> the ENTIRE request routes through `remapQrCode` instead of `updateQrCode` (see this file's header). */
  targetLinkId: z.string().min(1).optional(),
});

/**
 * Strips an optional `data:<mime>[;<param>...];base64,` prefix before
 * decoding (T-07-LOGO-MIME: the declared mime here is never trusted —
 * `normalizeLogo`, lib/qr.ts, sniffs magic bytes instead).
 *
 * `[^,]*` — not `[^;]+` — because a data URI may carry additional
 * parameters between the media type and the base64 marker (e.g.
 * `data:image/svg+xml;charset=utf-8;base64,...`, a form Blob/FileReader
 * legitimately produces). The stricter pattern failed to match those, so the
 * prefix survived into `Buffer.from(..., "base64")` and corrupted the
 * leading bytes, turning a valid upload into an INVALID_LOGO 400.
 */
const DATA_URI_PREFIX = /^data:[^,]*;base64,/;

function decodeLogoData(logoData: string): Buffer {
  return Buffer.from(logoData.replace(DATA_URI_PREFIX, ""), "base64");
}

/** Maps a `QrCodeErrorCode | "NOT_FOUND"` union (update/remap/history results) to an HTTP status — `statusForQrError` (lib/qrCodes.ts) handles the former; `NOT_FOUND` is only reachable in theory (resolveOwnedQrCode already proved existence before these are called). */
function statusForQrErrorOrNotFound(error: QrCodeErrorCode | "NOT_FOUND"): number {
  if (error === "NOT_FOUND") return 404;
  return statusForQrError(error);
}

/** Resolves the caller's user id from the session cookie, or `undefined`. Mirrors routes/links.ts. */
async function resolveUserId(auth: Auth, request: FastifyRequest): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user?.id;
}

/**
 * The IDOR guard (T-07-IDOR) — copies `routes/links.ts`'s `resolveOwnedLink`
 * / `routes/analytics.ts`'s copy of it verbatim in shape, joining through
 * the bound Link's `domainId` since QrCode has no `domainId` column of its
 * own. `scopedDomainIds` always runs FIRST regardless of whether the
 * QrCode even exists, so found/not-found/forbidden all cost the same query
 * count (no timing side channel). Includes the `link` relation AND that
 * Link's `domain` so render endpoints below never need a second query to
 * build a static QR's short-link payload (`{domain.hostname}/{link.slug}`).
 */
async function resolveOwnedQrCode(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<QrCodeWithLink | null> {
  const domainIds = await scopedDomainIds(prisma, userId);
  return prisma.qrCode.findFirst({
    where: { id, link: { domainId: { in: domainIds } } },
    include: { link: { include: { domain: true } } },
  });
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set — routes/qrCodes.ts must only be imported after env validation.`);
  }
  return value;
}

/**
 * Resolves the payload string a QR encodes (QR-06). BOTH variants encode a
 * Kurzly URL — never the raw destination — so every scan is a real request
 * to this service.
 *
 * A `static` QR encodes its bound Link's OWN short URL
 * (`https://{domain.hostname}/{slug}`), matching QR-01 ("statischer
 * QR-Code zu einem Kurzlink"), 07-CONTEXT.md's "static QR bound to an
 * existing short link", and ROADMAP Phase 7 success criterion 1. Encoding
 * `Link.targetUrl` instead would send the scanner straight to the
 * destination: `resolveLinkState`'s password gate and expiry gate would
 * never run, the click hook would never fire, and editing the Link's target
 * later would silently invalidate every already-printed code.
 *
 * That short URL carries a `?qr={id}` marker (QR-07). Unlike a dynamic code,
 * a static one has no route of its own — its scans arrive at the shared `GET
 * /:slug` handler, which would otherwise have no way to tell a scan from any
 * other visit, leaving the scan count pinned at 0. `routes/redirect.ts`
 * attributes the marker back to this row and strips it before any
 * `forwardQuery` merge, so it never reaches the destination.
 *
 * A `dynamic` QR instead encodes THIS instance's own stable `/q/:code`
 * short URL — re-pointing it (`remapQrCode`) changes its CURRENT target
 * but never this printed URL (QR-03's headline guarantee), which is the
 * entire reason a dynamic QR's `code` exists independently of any one Link.
 */
function resolveQrPayload(qrCode: QrCodeWithLink): string {
  if (qrCode.variant === "dynamic") {
    return `${requireEnv("BASE_URL")}/q/${qrCode.code}`;
  }
  return `https://${qrCode.link.domain.hostname}/${qrCode.link.slug}?${QR_SCAN_PARAM}=${qrCode.id}`;
}

/** Builds the `lib/qr.ts` render style from a QrCode's CURRENTLY stored fields — never a client-supplied style at render time. */
function resolveRenderStyle(qrCode: QrCodeWithLink): RenderStyle {
  return {
    color: qrCode.color,
    rounded: qrCode.roundedModules,
    logo: qrCode.logoEnabled && qrCode.logoData ? { bytes: Buffer.from(qrCode.logoData) } : undefined,
  };
}

export function qrCodesRoute(prisma: PrismaClient, auth: Auth) {
  return async function registerQrCodesRoute(app: FastifyInstance): Promise<void> {
    // POST /api/qr-codes (QR-01) — create static|dynamic, IDOR-checked via
    // the bound/initial-target Link's domain (createQrCode's own
    // resolveLinkDomainAccess), mass-assignment-guarded.
    app.route({
      method: "POST",
      url: "/api/qr-codes",
      config: { rateLimit: QR_CREATE_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const parsed = createQrCodeSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid QR data" });
        }

        // Delegates every write to createQrCode (lib/qrCodes.ts) — the
        // ONLY prisma.qrCode.create call site. No prisma.qrCode.create
        // call belongs here.
        const result = await createQrCode(prisma, { userId, ...parsed.data });
        if (!result.ok) {
          return reply.code(statusForQrError(result.error)).send({ error: result.error });
        }

        return reply.code(201).send(toQrCodeDto(result.qrCode));
      },
    });

    // GET /api/qr-codes — list, domain-scoped (never the whole instance).
    app.get("/api/qr-codes", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const domainIds = await scopedDomainIds(prisma, userId);
      const qrCodes = await prisma.qrCode.findMany({
        where: { link: { domainId: { in: domainIds } } },
        orderBy: { createdAt: "desc" },
      });

      return reply.send(qrCodes.map(toQrCodeDto));
    });

    // GET /api/qr-codes/:id — detail, same IDOR guard as PATCH/render below.
    app.get("/api/qr-codes/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = request.params as { id: string };
      const qrCode = await resolveOwnedQrCode(prisma, userId, id);
      if (!qrCode) return reply.code(404).send({ error: "Not found" });

      return reply.send(toQrCodeDto(qrCode));
    });

    // GET /api/qr-codes/:id/remap-history (QR-04 read seam, see this
    // file's header) — reuses getQrRemapHistory's own IDOR check
    // (NOT_FOUND/UNAUTHORIZED_DOMAIN both map to 404 — identical outcome).
    app.get(
      "/api/qr-codes/:id/remap-history",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id: string };
        const result = await getQrRemapHistory(prisma, id, userId);
        if (!result.ok) return reply.code(404).send({ error: "Not found" });

        return reply.send(result.entries.map(toQrRemapHistoryEntryDto));
      },
    );

    // DELETE /api/qr-codes/:id (WR-07) — delete, same IDOR guard as
    // GET/PATCH (resolveOwnedQrCode). No manual QrRemapHistory cleanup: the
    // FK is onDelete: Cascade (schema.prisma), proven by the integration
    // suite's cascade test.
    app.delete("/api/qr-codes/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = request.params as { id: string };
      const qrCode = await resolveOwnedQrCode(prisma, userId, id);
      if (!qrCode) return reply.code(404).send({ error: "Not found" });

      await prisma.qrCode.delete({ where: { id } });
      return reply.code(204).send();
    });

    // PATCH /api/qr-codes/:id — style update (color/rounded/logo/name) via
    // updateQrCode, OR — when targetLinkId is present — a remap via
    // remapQrCode. Same IDOR guard as GET :id. Delegates every write to
    // lib/qrCodes.ts; never touches the QrCode row directly.
    app.patch("/api/qr-codes/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = await resolveUserId(auth, request);
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = request.params as { id: string };
      const existing = await resolveOwnedQrCode(prisma, userId, id);
      if (!existing) return reply.code(404).send({ error: "Not found" });

      const parsed = updateQrCodeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid QR data" });
      }

      if (parsed.data.targetLinkId !== undefined) {
        const result = await remapQrCode(prisma, id, parsed.data.targetLinkId, userId);
        if (!result.ok) {
          return reply.code(statusForQrErrorOrNotFound(result.error)).send({ error: result.error });
        }
        return reply.send(toQrCodeDto(result.qrCode));
      }

      let logo: { bytes: Buffer } | null | undefined;
      if (parsed.data.logoData === null) {
        logo = null;
      } else if (parsed.data.logoData !== undefined) {
        logo = { bytes: decodeLogoData(parsed.data.logoData) };
      }

      // Defence-in-depth, mirroring the render handlers below: normalizeLogo
      // is the single funnel that types every logo rejection as
      // InvalidLogoError, but this handler must never be the layer that turns
      // a bad upload into an unhandled 500 (see this file's header contract).
      let result: Awaited<ReturnType<typeof updateQrCode>>;
      try {
        result = await updateQrCode(prisma, id, {
          userId,
          name: parsed.data.name,
          color: parsed.data.color,
          roundedModules: parsed.data.roundedModules,
          logoEnabled: parsed.data.logoEnabled,
          logo,
        });
      } catch (err) {
        if (err instanceof InvalidLogoError) {
          return reply.code(400).send({ error: "INVALID_LOGO" });
        }
        if (err instanceof InvalidColorError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }

      if (!result.ok) {
        return reply.code(statusForQrErrorOrNotFound(result.error)).send({ error: result.error });
      }

      return reply.send(toQrCodeDto(result.qrCode));
    });

    // GET /api/qr-codes/:id/render.png — on-demand PNG bytes (QR-06),
    // owner-scoped, rendered from the QrCode's CURRENTLY stored style via
    // lib/qr.ts. Dedicated QR_RENDER_RATE_LIMIT bucket (this file's header).
    app.route({
      method: "GET",
      url: "/api/qr-codes/:id/render.png",
      config: { rateLimit: QR_RENDER_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id: string };
        const qrCode = await resolveOwnedQrCode(prisma, userId, id);
        if (!qrCode) return reply.code(404).send({ error: "Not found" });

        try {
          const png = await renderQrPng(resolveQrPayload(qrCode), resolveRenderStyle(qrCode));
          return reply.header("Cache-Control", "no-store").type("image/png").send(png);
        } catch (err) {
          if (err instanceof InvalidColorError || err instanceof InvalidLogoError) {
            return reply.code(400).send({ error: err.message });
          }
          throw err;
        }
      },
    });

    // GET /api/qr-codes/:id/render.svg — same as render.png, SVG output.
    app.route({
      method: "GET",
      url: "/api/qr-codes/:id/render.svg",
      config: { rateLimit: QR_RENDER_RATE_LIMIT },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = await resolveUserId(auth, request);
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id: string };
        const qrCode = await resolveOwnedQrCode(prisma, userId, id);
        if (!qrCode) return reply.code(404).send({ error: "Not found" });

        try {
          const svg = await renderQrSvg(resolveQrPayload(qrCode), resolveRenderStyle(qrCode));
          return reply.header("Cache-Control", "no-store").type("image/svg+xml").send(svg);
        } catch (err) {
          if (err instanceof InvalidColorError || err instanceof InvalidLogoError) {
            return reply.code(400).send({ error: err.message });
          }
          throw err;
        }
      },
    });
  };
}
