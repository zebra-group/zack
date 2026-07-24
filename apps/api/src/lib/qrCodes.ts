/**
 * QrCode core (D-01-equivalent single-write-path enforcement, QR-02/03/04).
 *
 * `resolveLinkDomainAccess` is the SOLE authorization gate for every QrCode
 * content/target write in the codebase: it resolves the QrCode's
 * bound/target Link and calls `requireDomainAccess(prisma, userId,
 * link.domainId, "member")` — reused verbatim from
 * apps/api/src/lib/authorization.ts, zero new authorization code. Every
 * operation below goes through it: `createQrCode` (via the
 * `validateQrCodeInput` wrapper), `updateQrCode`, `remapQrCode` (on BOTH
 * sides of a re-point) and `getQrRemapHistory`. A QrCode has no `domainId`
 * column of its own (see schema.prisma's QrCode model comment) — its
 * authorization boundary is always its bound/target Link's `domainId`. It
 * performs ZERO database writes for the create path other than resolving a
 * collision-free `code` candidate (a read-only lookup, mirroring
 * `resolveSlug`'s own pure-check shape in lib/links.ts).
 *
 * `createQrCode` is the ONLY `prisma.qrCode.create` call site in the
 * entire codebase (mirrors `createLink`'s D-01 guarantee). `updateQrCode`
 * is the ONLY `prisma.qrCode.update` call site for QrCode *style* fields
 * (name/color/roundedModules/logoEnabled/logoData) — it can NEVER touch
 * `code`, `variant`, `lifetimeScans`, or `linkId`; those fields are either
 * server-owned (code/lifetimeScans/variant are immutable after create) or
 * exclusively mutated by `remapQrCode` (linkId, for a dynamic QR only).
 * `remapQrCode` is the ONLY other `prisma.qrCode.update` call site — it
 * batches the target-Link update with a `QrRemapHistory` insert in one
 * `prisma.$transaction` (mirrors `routes/redirect.ts`'s `recordClickHook`
 * batching the ClickEvent insert + `Link.lifetimeClicks` increment) so the
 * history can never drift from the current target. A future `/q/:code`
 * scan hook (07-06) adding one narrow, intentional exception —
 * incrementing ONLY `lifetimeScans` — is the one documented parallel to
 * `redirect.ts`'s `lifetimeClicks` increment; it must never touch any
 * field this file validates.
 *
 * Anti-pattern this file exists to prevent (mirrors lib/links.ts's header):
 * a future "optimization" that calls `prisma.qrCode.create`/`update`
 * directly from a route (bypassing this validation core) would silently
 * reintroduce a parallel write path that skips every rule below. Do not
 * add one.
 */
import type { PrismaClient, QrCode, QrCodeVariant, QrRemapHistory } from "../generated/prisma/client.js";
import { ForbiddenError, requireDomainAccess } from "./authorization.js";
import { AUTO_SLUG_RETRY_LIMIT, generateSlug, isUniqueConstraintViolation } from "./links.js";
import { InvalidLogoError, normalizeLogo, type LogoInput } from "./qr.js";

/** Style default (mirrors links.ts's `resolvePasswordHashCost`-style locally-scoped default constants). */
const DEFAULT_QR_COLOR = "#000000";

export type QrCodeErrorCode =
  | "UNAUTHORIZED_DOMAIN"
  | "NOT_DYNAMIC"
  | "CODE_GENERATION_EXHAUSTED"
  | "INVALID_LOGO"
  | "QR_ALREADY_EXISTS";

/**
 * Resolves `linkId`'s owning Domain and checks `requireDomainAccess` —
 * the ONE place every QrCode operation (create/update/remap/history)
 * checks authorization, so a caller-supplied `linkId` a non-member cannot
 * reach never distinguishes "Link doesn't exist" from "Link exists but
 * I'm not a member" (identical `UNAUTHORIZED_DOMAIN` outcome either way —
 * no existence oracle, mirrors lib/links.ts's WR-04-fixed convention).
 */
async function resolveLinkDomainAccess(
  prisma: PrismaClient,
  userId: string,
  linkId: string,
): Promise<{ ok: true; domainId: string } | { ok: false; error: "UNAUTHORIZED_DOMAIN" }> {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) return { ok: false, error: "UNAUTHORIZED_DOMAIN" };

  try {
    await requireDomainAccess(prisma, userId, link.domainId, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "UNAUTHORIZED_DOMAIN" };
    throw err;
  }

  return { ok: true, domainId: link.domainId };
}

export type ValidateQrCodeInputParams = {
  userId: string;
  variant: QrCodeVariant;
  /** The Link to bind (static) or the initial target Link (dynamic). */
  linkId: string;
  name: string;
  color?: string;
  roundedModules?: boolean;
};

type ValidatedQrCode = {
  variant: QrCodeVariant;
  linkId: string;
  name: string;
  color: string;
  roundedModules: boolean;
};

type ValidationResult =
  | { ok: true; data: ValidatedQrCode }
  | { ok: false; error: QrCodeErrorCode };

/**
 * The pure validation core for the CREATE path — ZERO database writes beyond
 * the read-only `resolveLinkDomainAccess` check above.
 *
 * Deliberately module-private: `createQrCode` is its only caller, and the
 * shared authorization gate every other operation reuses is
 * `resolveLinkDomainAccess`, not this wrapper. Exporting it implied a
 * codebase-wide contract ("call this before any QrCode write") that
 * `updateQrCode`/`remapQrCode`/`getQrRemapHistory` do not and should not
 * follow — they have no create-shaped input to default. Do not duplicate
 * `requireDomainAccess` calls elsewhere; route them through
 * `resolveLinkDomainAccess` instead.
 */
async function validateQrCodeInput(
  prisma: PrismaClient,
  input: ValidateQrCodeInputParams,
): Promise<ValidationResult> {
  const access = await resolveLinkDomainAccess(prisma, input.userId, input.linkId);
  if (!access.ok) return access;

  return {
    ok: true,
    data: {
      variant: input.variant,
      linkId: input.linkId,
      name: input.name,
      color: input.color ?? DEFAULT_QR_COLOR,
      roundedModules: input.roundedModules ?? false,
    },
  };
}

/**
 * Resolves a collision-free dynamic `/q/:code` short code by reusing
 * `generateSlug`/`AUTO_SLUG_RETRY_LIMIT` from lib/links.ts verbatim (same
 * 7-char Base62 alphabet/length lib/links.ts already uses for auto-slugs —
 * no re-derivation, per the Don't-Hand-Roll convention). `code` is a flat,
 * globally-unique namespace (NOT domain-scoped like `Link.slug`), so the
 * collision check is a simple `findUnique` on `code` alone.
 */
async function resolveDynamicCode(
  prisma: PrismaClient,
): Promise<{ ok: true; code: string } | { ok: false }> {
  for (let attempt = 0; attempt < AUTO_SLUG_RETRY_LIMIT; attempt++) {
    const candidate = generateSlug();
    const existing = await prisma.qrCode.findUnique({ where: { code: candidate } });
    if (!existing) return { ok: true, code: candidate };
  }
  return { ok: false };
}

export type CreateQrCodeResult = { ok: true; qrCode: QrCode } | { ok: false; error: QrCodeErrorCode };

/**
 * `createQrCode` = `validateQrCodeInput` + (for `dynamic`) collision-free
 * code resolution + a single insert. This is the ONLY `prisma.qrCode.create`
 * call site in the codebase.
 */
export async function createQrCode(
  prisma: PrismaClient,
  input: ValidateQrCodeInputParams,
): Promise<CreateQrCodeResult> {
  const validated = await validateQrCodeInput(prisma, input);
  if (!validated.ok) return validated;

  // WR-09 friendly-fast-path pre-check (mirrors createLink's `resolveSlug`
  // pre-check in lib/links.ts): the DB's partial unique index
  // (`QrCode_linkId_static_key`, WHERE variant='static') is the real
  // guarantee — this is only a friendly error for the common non-race case.
  if (validated.data.variant === "static") {
    const existingStatic = await prisma.qrCode.findFirst({
      where: { linkId: validated.data.linkId, variant: "static" },
    });
    if (existingStatic) return { ok: false, error: "QR_ALREADY_EXISTS" };
  }

  let code: string | null = null;
  if (validated.data.variant === "dynamic") {
    const codeResult = await resolveDynamicCode(prisma);
    if (!codeResult.ok) return { ok: false, error: "CODE_GENERATION_EXHAUSTED" };
    code = codeResult.code;
  }

  try {
    const qrCode = await prisma.qrCode.create({
      data: {
        variant: validated.data.variant,
        linkId: validated.data.linkId,
        code,
        name: validated.data.name,
        color: validated.data.color,
        roundedModules: validated.data.roundedModules,
        createdBy: input.userId,
      },
    });
    return { ok: true, qrCode };
  } catch (err) {
    // Two DISTINCT P2002 causes can reach this catch, disambiguated by
    // variant: a `static` create can only collide on the
    // `QrCode_linkId_static_key` partial unique index (a race after the
    // pre-check above — the real guarantee) -> QR_ALREADY_EXISTS. A
    // `dynamic` create can only collide on `code`'s own unique constraint (a
    // race after resolveDynamicCode's pre-check, mirrors createLink's
    // SLUG_TAKEN P2002 catch) -> a randomly-generated code has no "friendly
    // rename" retry path a caller can act on, so this maps to the same
    // exhaustion error as before.
    if (isUniqueConstraintViolation(err)) {
      return {
        ok: false,
        error: validated.data.variant === "static" ? "QR_ALREADY_EXISTS" : "CODE_GENERATION_EXHAUSTED",
      };
    }
    throw err;
  }
}

export type UpdateQrCodeParams = {
  userId: string;
  name?: string;
  color?: string;
  roundedModules?: boolean;
  logoEnabled?: boolean;
  /**
   * Raw uploaded logo bytes — `undefined` no-change, `null` clears the
   * stored logo, a `LogoInput` normalizes (via `normalizeLogo`, lib/qr.ts)
   * and replaces it. This is the ONLY place `logoData`/`logoMimeType` are
   * ever written (mirrors `derivePasswordHash` being the sole place
   * `Link.passwordHash` is derived in lib/links.ts).
   */
  logo?: LogoInput | null;
};

export type UpdateQrCodeResult =
  | { ok: true; qrCode: QrCode }
  | { ok: false; error: QrCodeErrorCode | "NOT_FOUND" };

/**
 * The ONLY `prisma.qrCode.update` call site for QrCode *style* fields.
 * Re-checks domain access via the QrCode's CURRENT bound/target Link
 * (mirrors `updateLink` re-validating via the same D-01 core) — never
 * accepts `code`/`variant`/`lifetimeScans`/`linkId` in its input type at
 * all (T-07-MASS, compile-time exclusion), and the Prisma `data` object
 * below never references them either (defense-in-depth against a caller
 * that bypasses the type via an unsafe cast).
 */
export async function updateQrCode(
  prisma: PrismaClient,
  qrCodeId: string,
  input: UpdateQrCodeParams,
): Promise<UpdateQrCodeResult> {
  const existing = await prisma.qrCode.findUnique({ where: { id: qrCodeId } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  const access = await resolveLinkDomainAccess(prisma, input.userId, existing.linkId);
  if (!access.ok) return access;

  let logoData: Uint8Array<ArrayBuffer> | null | undefined;
  let logoMimeType: string | null | undefined;
  if (input.logo === null) {
    logoData = null;
    logoMimeType = null;
  } else if (input.logo) {
    try {
      const normalized = await normalizeLogo(input.logo);
      // `Buffer`'s underlying ArrayBufferLike can type-narrow to
      // SharedArrayBuffer, which Prisma's generated Bytes-field input
      // (Uint8Array<ArrayBuffer>) rejects — Uint8Array.from always
      // allocates a fresh, genuinely non-shared ArrayBuffer, so this cast
      // only corrects the inferred generic parameter, not the runtime
      // guarantee.
      logoData = Uint8Array.from(normalized.buffer) as Uint8Array<ArrayBuffer>;
      logoMimeType = "image/png"; // normalizeLogo always rasterizes SVG to PNG (T-07-LOGO-SVG) — stored bytes are always PNG.
    } catch (err) {
      if (err instanceof InvalidLogoError) return { ok: false, error: "INVALID_LOGO" };
      throw err;
    }
  }

  const qrCode = await prisma.qrCode.update({
    where: { id: qrCodeId },
    data: {
      name: input.name,
      color: input.color,
      roundedModules: input.roundedModules,
      logoEnabled: input.logoEnabled,
      logoData,
      logoMimeType,
    },
  });
  return { ok: true, qrCode };
}

export type RemapQrCodeResult =
  | { ok: true; qrCode: QrCode }
  | { ok: false; error: QrCodeErrorCode | "NOT_FOUND" };

/**
 * Re-points a `dynamic` QrCode's CURRENT target Link — the headline
 * correctness guarantee of this phase (QR-03): `code` is NEVER present in
 * the update `data` below, so a remap structurally cannot touch it.
 * Checks `requireDomainAccess` against BOTH the QrCode's CURRENT-target
 * domain AND the NEW target Link's domain (T-07-IDOR) — a caller must be a
 * member of both sides of the re-point, not just one. Batches the
 * `QrCode.linkId` update with the `QrRemapHistory` insert in one
 * `prisma.$transaction` (mirrors `routes/redirect.ts`'s `recordClickHook`)
 * so the history can never drift from the current target (QR-04).
 */
export async function remapQrCode(
  prisma: PrismaClient,
  qrCodeId: string,
  newLinkId: string,
  userId: string,
): Promise<RemapQrCodeResult> {
  const existing = await prisma.qrCode.findUnique({ where: { id: qrCodeId } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };
  if (existing.variant !== "dynamic") return { ok: false, error: "NOT_DYNAMIC" };

  const currentAccess = await resolveLinkDomainAccess(prisma, userId, existing.linkId);
  if (!currentAccess.ok) return currentAccess;

  const newAccess = await resolveLinkDomainAccess(prisma, userId, newLinkId);
  if (!newAccess.ok) return newAccess;

  const fromLinkId = existing.linkId;
  const [qrCode] = await prisma.$transaction([
    prisma.qrCode.update({
      where: { id: qrCodeId },
      data: { linkId: newLinkId },
    }),
    prisma.qrRemapHistory.create({
      data: { qrCodeId, fromLinkId, toLinkId: newLinkId },
    }),
  ]);

  return { ok: true, qrCode };
}

export type GetQrRemapHistoryResult =
  | { ok: true; entries: QrRemapHistory[] }
  | { ok: false; error: "NOT_FOUND" | "UNAUTHORIZED_DOMAIN" };

/** Ownership-checked, chronological (oldest -> newest) remap history for one QrCode (QR-04). */
export async function getQrRemapHistory(
  prisma: PrismaClient,
  qrCodeId: string,
  userId: string,
): Promise<GetQrRemapHistoryResult> {
  const qrCode = await prisma.qrCode.findUnique({ where: { id: qrCodeId } });
  if (!qrCode) return { ok: false, error: "NOT_FOUND" };

  const access = await resolveLinkDomainAccess(prisma, userId, qrCode.linkId);
  if (!access.ok) return access;

  const entries = await prisma.qrRemapHistory.findMany({
    where: { qrCodeId },
    orderBy: { createdAt: "asc" },
  });
  return { ok: true, entries };
}

/**
 * Maps a `QrCodeDTO`-shaped response from a Prisma `QrCode` row (ISO-string
 * dates, JSON-boundary convention, mirrors `toLinkDto`). `logoData`/
 * `logoMimeType` are intentionally NEVER read onto this object
 * (T-07-DTO-LEAK) — only the derived `logoEnabled` boolean crosses the
 * JSON boundary, plus `hasLogo` (also just a boolean, never the bytes)
 * so a client can distinguish "toggle on, nothing uploaded" from
 * "toggle on, real logo already stored".
 */
export function toQrCodeDto(qrCode: QrCode) {
  return {
    id: qrCode.id,
    variant: qrCode.variant,
    linkId: qrCode.linkId,
    code: qrCode.code,
    name: qrCode.name,
    color: qrCode.color,
    roundedModules: qrCode.roundedModules,
    logoEnabled: qrCode.logoEnabled,
    hasLogo: qrCode.logoData !== null,
    lifetimeScans: qrCode.lifetimeScans,
    createdBy: qrCode.createdBy,
    createdAt: qrCode.createdAt.toISOString(),
    updatedAt: qrCode.updatedAt.toISOString(),
  };
}

/** Maps a `QrRemapHistoryEntryDTO`-shaped response from a Prisma `QrRemapHistory` row. */
export function toQrRemapHistoryEntryDto(entry: QrRemapHistory) {
  return {
    id: entry.id,
    qrCodeId: entry.qrCodeId,
    fromLinkId: entry.fromLinkId,
    toLinkId: entry.toLinkId,
    createdAt: entry.createdAt.toISOString(),
  };
}

/** Maps a QrCode error code to its HTTP status — exhaustive switch with a compile-time `never` check (mirrors `statusForLinkError`). */
export function statusForQrError(error: QrCodeErrorCode): number {
  switch (error) {
    case "UNAUTHORIZED_DOMAIN":
      // Mapped to 404 upstream (not 403, unlike Link's UNAUTHORIZED_DOMAIN)
      // — a QrCode's domain boundary is never client-visible the way a
      // Link's requested `domainId` is, so denying existence entirely
      // (identical-404, no existence oracle) is the correct posture here.
      return 404;
    case "NOT_DYNAMIC":
      return 400;
    case "CODE_GENERATION_EXHAUSTED":
      return 503;
    case "INVALID_LOGO":
      return 400;
    case "QR_ALREADY_EXISTS":
      return 409;
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
