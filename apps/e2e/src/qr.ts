/**
 * E2E fixture + decode helper for `QrCode` rows (15-01-PLAN.md, QR-E2E-01/02/03).
 *
 * Two genuinely-new assets this phase needs before any feature spec can run:
 *
 * - `createE2eQrCode`: a raw-insert `prisma.qrCode.create` fixture helper,
 *   mirroring `apps/e2e/src/links.ts`'s `createE2eLink` shape. Needed
 *   because the real "+ Dynamischer QR" UI create always binds to
 *   `links.value[0]` (whatever `GET /api/links` returns first) — not
 *   deterministic enough to reliably set up "starts bound to target A" for
 *   QR-E2E-02/03. Like `createLink`/`updateLink` before it (12-RESEARCH.md
 *   Q2), `lib/qrCodes.ts`'s `createQrCode` is NOT exported via
 *   `@kurzly/api`'s `exports` map (only `.`/`./prisma-client` are) and is
 *   therefore structurally unreachable from `apps/e2e` — a raw insert is
 *   the only option, exactly as `createE2eLink` established.
 *
 * - `decodeQrImage`: the sharp(bytes).ensureAlpha().raw() -> jsQR decode
 *   recipe, ported VERBATIM from `apps/api/test/qrDecode.test.ts`'s own
 *   `decode()` helper (already proven, already passing in CI against this
 *   exact renderer's output, including logo-composited symbols) — only the
 *   byte SOURCE differs (a real HTTP fetch of `render.png`/`render.svg`
 *   bytes here, vs. an in-process render call there). Every feature spec's
 *   decode assertion (QR-E2E-01/03) reuses this single, already-trusted
 *   path rather than inventing a second, unproven one.
 */
import { randomBytes } from "node:crypto";
import jsQR from "jsqr";
import sharp from "sharp";
import type { Prisma, PrismaClient } from "@kurzly/api/prisma-client";

/** Accepts either a top-level PrismaClient or a `withResetDbLock` transaction client. */
type E2ePrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Generates a random dynamic-QR `code` — 16 lowercase-hex characters, well
 * within `routes/qrRedirect.ts`'s `QR_CODE_PARAM` shape gate
 * (`/^[0-9A-Za-z]{1,32}$/`). E2E's tiny scale needs no collision-retry loop
 * (15-RESEARCH.md Assumption A2): `@kurzly/api`'s own `generateSlug` is not
 * exported from its `exports` map and is structurally unreachable from
 * `apps/e2e` (mirrors `createE2eLink`'s own note on `generateSlug`).
 */
function randomQrCode(): string {
  return randomBytes(8).toString("hex");
}

export type CreateE2eQrCodeOptions = {
  variant: "static" | "dynamic";
  linkId: string;
  name: string;
  /** Defaults to "#000000" — the schema has no column default, a value MUST always be supplied. */
  color?: string;
  /** Defaults to false. */
  roundedModules?: boolean;
};

/**
 * Raw-insert QrCode fixture helper. Sets `code` to a fresh `randomQrCode()`
 * for a `dynamic` variant, `null` for `static` (the schema's `code String?
 * @unique` is dynamic-only). Deliberately never sets `createdBy` — it is
 * nullable, and the render/redirect IDOR scope resolves through the bound
 * Link's domain, not `createdBy`.
 */
export async function createE2eQrCode(prisma: E2ePrismaLike, opts: CreateE2eQrCodeOptions) {
  return prisma.qrCode.create({
    data: {
      variant: opts.variant,
      linkId: opts.linkId,
      code: opts.variant === "dynamic" ? randomQrCode() : null,
      name: opts.name,
      color: opts.color ?? "#000000",
      roundedModules: opts.roundedModules ?? false,
    },
  });
}

/**
 * Decodes an image buffer (PNG bytes, or a pre-rasterized SVG-as-PNG
 * buffer) back to its encoded QR payload string, or `null` if no code was
 * found. Verbatim port of `apps/api/test/qrDecode.test.ts`'s `decode()`
 * helper (lines 86-90) — only the byte SOURCE differs (real HTTP fetch here
 * vs. an in-process render call there).
 */
export async function decodeQrImage(bytes: Buffer): Promise<string | null> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result?.data ?? null;
}
