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

/**
 * Conservative logo tile fraction (linear, of the full QR dimension) —
 * mirrors the UI-SPEC's large-preview numbers (a 46px logo tile inside a
 * 196px preview). ~23.5% linear is ~5.5% of the QR's total area, well
 * under EC-level H's ~30% data-recovery ceiling (07-RESEARCH.md Pitfall 1
 * — that ceiling has to absorb print/scan variance too, so this stays a
 * fixed module-count-derived fraction, never a percentage of a shrinking
 * preview control this phase doesn't expose anyway).
 */
const LOGO_TILE_FRACTION = 46 / 196;

/**
 * ISO/IEC 18004 quiet-zone requirement: a light-colored margin of at
 * least 4 modules must surround the symbol for reliable real-world
 * scanning (matches `qrcode`'s own default `margin` option). [Rule 2 fix
 * — see SUMMARY.md.]
 */
const QUIET_ZONE_MODULES = 4;

/** Background/"light module" fill color — not user-configurable; only the dark-module color is styled (QR-06). */
const BACKGROUND_COLOR = "#ffffff";

/** PNG signature (first 8 bytes) — see https://www.w3.org/TR/png/#5PNG-file-signature */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Thrown by normalizeLogo when the supplied bytes are neither a valid PNG nor a valid SVG root (T-07-LOGO-MIME). */
export class InvalidLogoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLogoError";
  }
}

function resolveModuleStyle(style: RenderStyle): ModuleStyle {
  return {
    color: style.color ?? DEFAULT_COLOR,
    rounded: style.rounded ?? false,
    moduleSizePx: style.moduleSizePx ?? DEFAULT_MODULE_SIZE_PX,
  };
}

/** Full QR pixel dimension INCLUDING the quiet zone on all sides — same computation buildModuleSvg makes internally. */
function qrDimensionPx(payload: string, errorCorrectionLevel: QrErrorCorrectionLevel, moduleSizePx: number): number {
  const qr = QRCode.create(payload, { errorCorrectionLevel });
  return qr.modules.size * moduleSizePx + 2 * QUIET_ZONE_MODULES * moduleSizePx;
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
 * module into a single SVG string, painted over an explicit light/white
 * background rect covering the full symbol PLUS a 4-module quiet zone on
 * every side. This is the ONLY place module geometry is computed — both
 * `renderQrSvg` and `renderQrPng` (via rasterizing this exact string) go
 * through it (07-RESEARCH.md Pattern 1).
 *
 * [Rule 1 fix — see SUMMARY.md] The original version of this function
 * left "light" modules entirely unpainted, so sharp rasterized them as
 * fully-transparent RGB(0,0,0) pixels. jsQR ignores the alpha channel
 * when computing luminance (`0.2126*r + 0.7152*g + 0.0722*b`), so those
 * transparent pixels read as pure black — nearly indistinguishable from
 * a dark foreground color, giving only ~9% effective contrast. That was
 * just barely enough for jsQR's adaptive per-region binarizer to decode
 * a clean no-logo render, but any additional noise (a composited logo,
 * even at 5-10% linear coverage) tipped it over into failing to decode
 * at all. An explicit white background (+ the ISO/IEC 18004 quiet zone)
 * restores full ~100% contrast and real-world scannability.
 */
export function buildModuleSvg(payload: string, errorCorrectionLevel: QrErrorCorrectionLevel, style: ModuleStyle): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel });
  const size = qr.modules.size;
  const px = style.moduleSizePx;
  const cornerRadius = style.rounded ? px * 0.45 : 0;
  const margin = QUIET_ZONE_MODULES * px;

  const rects: string[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.modules.get(row, col)) continue;
      rects.push(
        `<rect x="${margin + col * px}" y="${margin + row * px}" width="${px}" height="${px}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${style.color}"/>`,
      );
    }
  }

  const dim = size * px + margin * 2;
  const background = `<rect x="0" y="0" width="${dim}" height="${dim}" fill="${BACKGROUND_COLOR}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">${background}${rects.join("")}</svg>`;
}

/**
 * Returns the styled SVG string for a QR code. When `style.logo` is
 * present, a centered `<image>` (base64 data-URI of the normalized logo
 * PNG) is injected at the same relative size/position the PNG composite
 * path uses (`LOGO_TILE_FRACTION`) — geometry stays otherwise identical
 * to the no-logo `buildModuleSvg` output (single-geometry guarantee).
 */
export async function renderQrSvg(payload: string, style: RenderStyle = {}): Promise<string> {
  const errorCorrectionLevel = resolveErrorCorrectionLevel(Boolean(style.logo));
  const moduleStyle = resolveModuleStyle(style);
  const svg = buildModuleSvg(payload, errorCorrectionLevel, moduleStyle);

  if (!style.logo) {
    // Deliberately the exact string returned for the no-logo case — must
    // stay byte-identical to buildModuleSvg's own output (see
    // qrDecode.test.ts's single-geometry-guarantee test).
    return svg;
  }

  const normalizedLogo = await normalizeLogo(style.logo);
  const dim = qrDimensionPx(payload, errorCorrectionLevel, moduleStyle.moduleSizePx);
  const logoTilePx = dim * LOGO_TILE_FRACTION;
  const offset = (dim - logoTilePx) / 2;
  const dataUri = `data:image/png;base64,${normalizedLogo.buffer.toString("base64")}`;
  const imageTag = `<image x="${offset}" y="${offset}" width="${logoTilePx}" height="${logoTilePx}" href="${dataUri}" preserveAspectRatio="xMidYMid slice"/>`;
  return svg.replace("</svg>", `${imageTag}</svg>`);
}

/**
 * Rasterizes the EXACT no-logo SVG string via sharp, then — when a logo
 * is present — sharp.composite()'s the normalized logo PNG centered on
 * top (gravity 'centre'), sized via the SAME `LOGO_TILE_FRACTION` the SVG
 * path uses. Never a second, independently-computed pixel-grid path.
 */
export async function renderQrPng(payload: string, style: RenderStyle = {}): Promise<Buffer> {
  const errorCorrectionLevel = resolveErrorCorrectionLevel(Boolean(style.logo));
  const moduleStyle = resolveModuleStyle(style);
  const svg = buildModuleSvg(payload, errorCorrectionLevel, moduleStyle);
  const basePng = await sharp(Buffer.from(svg)).png().toBuffer();

  if (!style.logo) {
    return basePng;
  }

  const normalizedLogo = await normalizeLogo(style.logo);
  const dim = qrDimensionPx(payload, errorCorrectionLevel, moduleStyle.moduleSizePx);
  const logoTilePx = Math.round(dim * LOGO_TILE_FRACTION);
  const resizedLogo = await sharp(normalizedLogo.buffer)
    .resize(logoTilePx, logoTilePx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp(basePng)
    .composite([{ input: resizedLogo, gravity: "centre" }])
    .png()
    .toBuffer();
}

/**
 * Validates uploaded logo bytes by magic-byte sniffing (PNG signature or
 * an SVG/XML root) — NEVER a client-declared `declaredMime` — and, for
 * SVG input, rasterizes to PNG immediately so no later render step ever
 * re-parses the original SVG markup (T-07-LOGO-SVG, 07-RESEARCH.md
 * Pitfall 5). Throws `InvalidLogoError` for anything else.
 */
export async function normalizeLogo(input: LogoInput): Promise<NormalizedLogo> {
  const { bytes } = input;

  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const metadata = await sharp(bytes).metadata();
    return { buffer: bytes, width: metadata.width ?? 0, height: metadata.height ?? 0 };
  }

  const head = bytes.subarray(0, 512).toString("utf8").trimStart();
  const looksLikeSvg = /^<\?xml/i.test(head) || /^<svg[\s>]/i.test(head) || /<svg[\s>]/i.test(head);
  if (looksLikeSvg) {
    // Rasterize once, now — never store/re-parse the original SVG markup
    // at a later render (07-RESEARCH.md Pitfall 5).
    const rasterBuffer = await sharp(bytes).png().toBuffer();
    const metadata = await sharp(rasterBuffer).metadata();
    return { buffer: rasterBuffer, width: metadata.width ?? 0, height: metadata.height ?? 0 };
  }

  throw new InvalidLogoError("Unsupported logo format: expected a PNG (magic bytes) or an SVG (XML/<svg> root)");
}
