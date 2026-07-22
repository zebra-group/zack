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

/**
 * Strict CSS hex (`#RGB` or `#RRGGBB`). `style.color` is interpolated RAW into a
 * `fill="${style.color}"` attribute in `buildModuleSvg`, so an unvalidated value
 * such as `#000" onload="alert(1)` (or one closing the attribute + injecting a
 * `<script>`/event handler) would break out of the attribute and execute when the
 * exported SVG is rendered in a browser — SVG attribute-injection XSS. Rejecting
 * anything but a hex literal at the single rendering seam is the authoritative
 * guard: no route or caller can reach `buildModuleSvg` with an unescaped color.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Thrown when the dark-module color is not a strict `#RGB`/`#RRGGBB` hex (SVG-injection guard). */
export class InvalidColorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidColorError";
  }
}

function assertValidColor(color: string): string {
  if (!HEX_COLOR.test(color)) {
    throw new InvalidColorError(
      `Invalid QR color: expected a #RGB or #RRGGBB hex literal, got ${JSON.stringify(color)}`,
    );
  }
  return color;
}

function resolveModuleStyle(style: RenderStyle): ModuleStyle {
  return {
    color: assertValidColor(style.color ?? DEFAULT_COLOR),
    rounded: style.rounded ?? false,
    moduleSizePx: style.moduleSizePx ?? DEFAULT_MODULE_SIZE_PX,
  };
}

/** `buildModuleSvg`'s full result: the SVG string plus the symbol's full pixel dimension INCLUDING the quiet zone. */
interface ModuleSvg {
  svg: string;
  dim: number;
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
  return buildModuleSvgWithDim(payload, errorCorrectionLevel, style).svg;
}

/**
 * The actual implementation, returning the symbol's pixel dimension
 * alongside the SVG string.
 *
 * The dimension is a by-product of the matrix this function has already
 * walked, so handing it back removes the separate `qrDimensionPx` helper
 * that re-ran `QRCode.create` on the identical payload/EC level purely to
 * measure the symbol — two full Reed-Solomon encodes per logo render, on the
 * endpoint with the highest rate limit in the app.
 */
function buildModuleSvgWithDim(
  payload: string,
  errorCorrectionLevel: QrErrorCorrectionLevel,
  style: ModuleStyle,
): ModuleSvg {
  // Authoritative SVG attribute-injection guard, applied at the exact interpolation site:
  // `style.color` is written raw into fill="${style.color}" below. buildModuleSvg is exported and
  // may be called directly (bypassing resolveModuleStyle), so validating here — not only in the
  // render entry points — is what actually closes the XSS vector for every caller.
  assertValidColor(style.color);
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">${background}${rects.join("")}</svg>`;
  return { svg, dim };
}

/**
 * Fits a normalized logo into the square `logoTilePx` box, letterboxed on
 * transparency — the ONE place logo tile geometry is computed, shared by
 * `renderQrSvg` and `renderQrPng` so the two exports can never diverge.
 */
async function resizeLogoToTile(logoBuffer: Buffer, logoTilePx: number): Promise<Buffer> {
  return sharp(logoBuffer)
    .resize(logoTilePx, logoTilePx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
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
  const { svg, dim } = buildModuleSvgWithDim(payload, errorCorrectionLevel, moduleStyle);

  if (!style.logo) {
    // Deliberately the exact string returned for the no-logo case — must
    // stay byte-identical to buildModuleSvg's own output (see
    // qrDecode.test.ts's single-geometry-guarantee test).
    return svg;
  }

  const normalizedLogo = await normalizeLogo(style.logo);
  const logoTilePx = dim * LOGO_TILE_FRACTION;
  const offset = (dim - logoTilePx) / 2;
  // Resize to the tile BEFORE embedding, exactly as the PNG path does.
  // Base64-embedding the original upload meant every render.svg response
  // carried up to ~1.8 MiB for a ~46px tile (LOGO_DATA_MAX_LENGTH permits a
  // ~1.36 MiB stored logo) on the highest-rate-limit endpoint in the app.
  const resizedLogo = await resizeLogoToTile(normalizedLogo.buffer, Math.round(logoTilePx));
  const dataUri = `data:image/png;base64,${resizedLogo.toString("base64")}`;
  // `meet` is the SVG spelling of sharp's `fit: "contain"` — the fit
  // resizeLogoToTile uses. `slice` (= cover) would scale the logo up and CROP
  // it to fill the square tile, so a non-square logo came out as visibly
  // different artwork in the two exports from the same stored bytes. Both
  // paths must letterbox identically (single-geometry guarantee, proven by
  // qrDecode.test.ts's non-square parity test).
  const imageTag = `<image x="${offset}" y="${offset}" width="${logoTilePx}" height="${logoTilePx}" href="${dataUri}" preserveAspectRatio="xMidYMid meet"/>`;
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
  const { svg, dim } = buildModuleSvgWithDim(payload, errorCorrectionLevel, moduleStyle);
  const basePng = await sharp(Buffer.from(svg)).png().toBuffer();

  if (!style.logo) {
    return basePng;
  }

  const normalizedLogo = await normalizeLogo(style.logo);
  const logoTilePx = Math.round(dim * LOGO_TILE_FRACTION);
  const resizedLogo = await resizeLogoToTile(normalizedLogo.buffer, logoTilePx);

  return sharp(basePng)
    .composite([{ input: resizedLogo, gravity: "centre" }])
    .png()
    .toBuffer();
}

/**
 * Explicit rasterization ceiling for an uploaded logo (~4000x4000). Well
 * below sharp's own ~268 MP default so the limit is a stated product
 * decision rather than an implementation detail, and enormously generous
 * for artwork that ends up in a ~46px tile. Exceeding it raises
 * `InvalidLogoError`, never an unhandled sharp Error (T-07-DOS-RENDER: a
 * ~200-byte SVG can otherwise declare a multi-gigapixel canvas).
 */
const LOGO_MAX_PIXELS = 16_000_000;

/**
 * Validates uploaded logo bytes by magic-byte sniffing (PNG signature or
 * an SVG/XML root) — NEVER a client-declared `declaredMime` — and, for
 * SVG input, rasterizes to PNG immediately so no later render step ever
 * re-parses the original SVG markup (T-07-LOGO-SVG, 07-RESEARCH.md
 * Pitfall 5).
 *
 * This is the SINGLE funnel every logo byte in the codebase passes
 * through, so it is also the single place logo rejection is typed:
 * `InvalidLogoError` is the ONLY error it may throw. Recognising the
 * container (PNG signature / `<svg>` root) does not mean sharp can
 * actually decode it — a valid PNG signature over a corrupt body, or an
 * SVG declaring dimensions past `LOGO_MAX_PIXELS`, both make sharp throw a
 * plain `Error`. Those used to escape through `updateQrCode`'s
 * rethrow-non-InvalidLogoError branch all the way to an unhandled 500, so
 * every sharp call below is wrapped and converted here instead.
 */
export async function normalizeLogo(input: LogoInput): Promise<NormalizedLogo> {
  const { bytes } = input;

  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    try {
      const metadata = await sharp(bytes, { limitInputPixels: LOGO_MAX_PIXELS }).metadata();
      return { buffer: bytes, width: metadata.width ?? 0, height: metadata.height ?? 0 };
    } catch (err) {
      throw new InvalidLogoError(`Unreadable PNG logo: ${(err as Error).message}`);
    }
  }

  const head = bytes.subarray(0, 512).toString("utf8").trimStart();
  const looksLikeSvg = /^<\?xml/i.test(head) || /^<svg[\s>]/i.test(head) || /<svg[\s>]/i.test(head);
  if (looksLikeSvg) {
    // Rasterize once, now — never store/re-parse the original SVG markup
    // at a later render (07-RESEARCH.md Pitfall 5).
    try {
      const rasterBuffer = await sharp(bytes, { limitInputPixels: LOGO_MAX_PIXELS }).png().toBuffer();
      const metadata = await sharp(rasterBuffer).metadata();
      return { buffer: rasterBuffer, width: metadata.width ?? 0, height: metadata.height ?? 0 };
    } catch (err) {
      throw new InvalidLogoError(`Unreadable SVG logo: ${(err as Error).message}`);
    }
  }

  throw new InvalidLogoError("Unsupported logo format: expected a PNG (magic bytes) or an SVG (XML/<svg> root)");
}
