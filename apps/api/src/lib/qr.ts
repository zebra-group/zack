/**
 * Shared QR rendering core (Phase 7, 07-03-PLAN.md).
 *
 * The ONE module-matrix renderer every downstream QR surface (thumbnail,
 * Studio preview, PNG export, SVG export) goes through — mirrors
 * `lib/links.ts`'s single-write-path discipline, applied to rendering
 * instead of persistence (07-RESEARCH.md Pattern 1).
 *
 * Deliberately does NOT call `qrcode`'s built-in `toString({type:'svg'})`:
 * that renderer emits one combined `<path>` for every dark module, leaving
 * no per-module node to round (07-RESEARCH.md Pitfall 2). Instead
 * `QRCode.create()` gives the raw module bit-matrix and `buildModuleSvg`
 * hand-writes one `<rect>` per dark module. `renderQrPng` rasterizes the
 * EXACT SVG string `renderQrSvg` returns via sharp — so PNG and SVG can
 * never structurally diverge (proven by qrDecode.test.ts's
 * single-geometry-guarantee test).
 *
 * Pure rendering module: no Prisma/DB access (07-RESEARCH.md Architectural
 * Responsibility Map — this tier is rendering only).
 */
import QRCode from "qrcode";
import sharp from "sharp";

/** Confirmed against node_modules/qrcode/lib/core/bit-matrix.js (07-RESEARCH.md Assumption A2). */
export type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface ModuleStyle {
  color: string;
  rounded: boolean;
  moduleSizePx: number;
}

/** Raw, not-yet-validated logo bytes as received from the caller/upload layer. */
export interface LogoInput {
  bytes: Buffer;
  /** Client-declared MIME type — NEVER trusted; normalizeLogo sniffs magic bytes instead (T-07-LOGO-MIME). */
  declaredMime?: string;
}

/** A logo that has passed magic-byte validation and (if it was SVG) already been rasterized to PNG once (T-07-LOGO-SVG). */
export interface NormalizedLogo {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface RenderStyle {
  color?: string;
  rounded?: boolean;
  moduleSizePx?: number;
  logo?: LogoInput;
}

const DEFAULT_COLOR = "#000000";
const DEFAULT_MODULE_SIZE_PX = 10;

function resolveModuleStyle(style: RenderStyle): ModuleStyle {
  return {
    color: style.color ?? DEFAULT_COLOR,
    rounded: style.rounded ?? false,
    moduleSizePx: style.moduleSizePx ?? DEFAULT_MODULE_SIZE_PX,
  };
}

/**
 * QR-05: whenever a logo is enabled, error-correction level is ALWAYS
 * forced to 'H' — never a client-settable field, mirrors
 * passwordHash/lifetimeClicks being server-owned in lib/links.ts.
 */
export function resolveErrorCorrectionLevel(logoEnabled: boolean): QrErrorCorrectionLevel {
  return logoEnabled ? "H" : "M";
}

/**
 * Walks the raw QR module bit-matrix and emits one `<rect>` per dark
 * module into a single SVG string. This is the ONLY place module
 * geometry is computed — both `renderQrSvg` and `renderQrPng` (via
 * rasterizing this exact string) go through it (07-RESEARCH.md Pattern 1).
 */
export function buildModuleSvg(payload: string, errorCorrectionLevel: QrErrorCorrectionLevel, style: ModuleStyle): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel });
  const size = qr.modules.size;
  const px = style.moduleSizePx;
  const cornerRadius = style.rounded ? px * 0.45 : 0;

  const rects: string[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.modules.get(row, col)) continue;
      rects.push(
        `<rect x="${col * px}" y="${row * px}" width="${px}" height="${px}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${style.color}"/>`,
      );
    }
  }

  const dim = size * px;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">${rects.join("")}</svg>`;
}

/**
 * Returns the styled SVG string for a QR code. When `style.logo` is
 * present, a centered `<image>` (base64 data-URI of the normalized logo
 * PNG) is injected at the same relative size/position as the PNG
 * composite path — implemented in Task 3.
 */
export async function renderQrSvg(payload: string, style: RenderStyle = {}): Promise<string> {
  const errorCorrectionLevel = resolveErrorCorrectionLevel(Boolean(style.logo));
  const moduleStyle = resolveModuleStyle(style);
  // NOTE: logo compositing lands in Task 3 (normalizeLogo + <image> inject).
  // This is deliberately the exact string returned for the no-logo case —
  // it must stay byte-identical to buildModuleSvg's own output (see
  // qrDecode.test.ts's single-geometry-guarantee test).
  return buildModuleSvg(payload, errorCorrectionLevel, moduleStyle);
}

/**
 * Rasterizes the EXACT SVG string `renderQrSvg` returns via sharp — never
 * a second, independently-computed pixel-grid path. Logo compositing
 * (sharp.composite()) lands in Task 3.
 */
export async function renderQrPng(payload: string, style: RenderStyle = {}): Promise<Buffer> {
  const svg = await renderQrSvg(payload, style);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Validates uploaded logo bytes by magic-byte sniffing (PNG signature or
 * an SVG/XML root) — NEVER a client-declared Content-Type — and, for SVG
 * input, rasterizes to PNG immediately so no later render step ever
 * re-parses the original SVG markup (T-07-LOGO-SVG, 07-RESEARCH.md
 * Pitfall 5). Implemented in Task 3.
 */
export async function normalizeLogo(_input: LogoInput): Promise<NormalizedLogo> {
  throw new Error("normalizeLogo is not implemented yet — see 07-03-PLAN.md Task 3");
}
