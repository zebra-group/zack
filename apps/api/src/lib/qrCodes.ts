/**
 * QrCode core (D-01-equivalent single-write-path enforcement, QR-02/03/04).
 *
 * `validateQrCodeInput` is the SOLE authorization + validation gate for
 * every QrCode content/target write in the codebase: it resolves the
 * QrCode's bound/target Link and calls `requireDomainAccess(prisma,
 * userId, link.domainId, "member")` — reused verbatim from
 * apps/api/src/lib/authorization.ts, zero new authorization code. A QrCode
 * has no `domainId` column of its own (see schema.prisma's QrCode model
 * comment) — its authorization boundary is always its bound/target Link's
 * `domainId`. It performs ZERO database writes for the create path other
 * than resolving a collision-free `code` candidate (a read-only lookup,
 * mirroring `resolveSlug`'s own pure-check shape in lib/links.ts).
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
import type { LogoInput } from "./qr.js";

/** Style default (mirrors links.ts's `resolvePasswordHashCost`-style locally-scoped default constants). */
const DEFAULT_QR_COLOR = "#000000";

export type QrCodeErrorCode =
  | "UNAUTHORIZED_DOMAIN"
  | "NOT_DYNAMIC"
  | "CODE_GENERATION_EXHAUSTED"
  | "INVALID_LOGO";

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

export type ValidatedQrCode = {
  variant: QrCodeVariant;
  linkId: string;
  name: string;
  color: string;
  roundedModules: boolean;
};

export type ValidationResult =
  | { ok: true; data: ValidatedQrCode }
  | { ok: false; error: QrCodeErrorCode };

/**
 * The pure validation core — ZERO database writes beyond the read-only
 * domain-access check above. Every QrCode create path calls this and
 * nothing else for authorization; do not duplicate `requireDomainAccess`
 * calls elsewhere.
 */
export async function validateQrCodeInput(
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
    // Defense-in-depth against a race between resolveDynamicCode's
    // pre-check and this insert (mirrors createLink's SLUG_TAKEN P2002
    // catch) — a randomly-generated code has no "friendly rename" retry
    // path a caller can act on, so this maps to the same exhaustion error.
    if (isUniqueConstraintViolation(err)) {
      return { ok: false, error: "CODE_GENERATION_EXHAUSTED" };
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
 * Implemented in 07-04-PLAN.md's Task 3 (style update + remap transaction
 * + remap history) — this stub exists only so Task 2's exports resolve
 * for the RED test file's top-level import.
 */
export async function updateQrCode(
  _prisma: PrismaClient,
  _qrCodeId: string,
  _input: UpdateQrCodeParams,
): Promise<UpdateQrCodeResult> {
  throw new Error("updateQrCode: not yet implemented (07-04-PLAN.md Task 3)");
}

export type RemapQrCodeResult =
  | { ok: true; qrCode: QrCode }
  | { ok: false; error: QrCodeErrorCode | "NOT_FOUND" };

/**
 * Re-points a `dynamic` QrCode's CURRENT target Link (QR-03/QR-04).
 * Implemented in 07-04-PLAN.md's Task 3 — this stub exists only so Task
 * 2's exports resolve for the RED test file's top-level import.
 */
export async function remapQrCode(
  _prisma: PrismaClient,
  _qrCodeId: string,
  _newLinkId: string,
  _userId: string,
): Promise<RemapQrCodeResult> {
  throw new Error("remapQrCode: not yet implemented (07-04-PLAN.md Task 3)");
}

export type GetQrRemapHistoryResult =
  | { ok: true; entries: QrRemapHistory[] }
  | { ok: false; error: "NOT_FOUND" | "UNAUTHORIZED_DOMAIN" };

/**
 * Ownership-checked, chronological remap history for one QrCode (QR-04).
 * Implemented in 07-04-PLAN.md's Task 3 — this stub exists only so Task
 * 2's exports resolve for the RED test file's top-level import.
 */
export async function getQrRemapHistory(
  _prisma: PrismaClient,
  _qrCodeId: string,
  _userId: string,
): Promise<GetQrRemapHistoryResult> {
  throw new Error("getQrRemapHistory: not yet implemented (07-04-PLAN.md Task 3)");
}

/**
 * Maps a `QrCodeDTO`-shaped response from a Prisma `QrCode` row (ISO-string
 * dates, JSON-boundary convention, mirrors `toLinkDto`). `logoData`/
 * `logoMimeType` are intentionally NEVER read onto this object
 * (T-07-DTO-LEAK) — only the derived `logoEnabled` boolean crosses the
 * JSON boundary.
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
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
