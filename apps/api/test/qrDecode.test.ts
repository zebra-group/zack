/**
 * Decode-round-trip + geometry test suite for lib/qr.ts (Phase 7, 07-03-PLAN.md
 * Task 1, RED).
 *
 * Blocking success criterion (QR-01/QR-05): a PNG export AND an SVG export
 * (both rasterized through sharp for decoding) must decode via jsQR back to
 * the exact encoded target URL, WITH a centered logo enabled. PNG and SVG
 * share a single module-matrix renderer (`buildModuleSvg`) so both formats
 * are guaranteed to render identical geometry — proven directly by the
 * single-geometry-guarantee test below (renderQrSvg's no-logo output must be
 * byte-identical to buildModuleSvg's output for the same inputs).
 *
 * See 07-RESEARCH.md Code Example 2 for the decode recipe (sharp .raw() +
 * jsQR) and Assumption A2 for the confirmed `qrcode` BitMatrix `.get(row,
 * col)` accessor (re-confirmed directly against
 * node_modules/qrcode/lib/core/bit-matrix.js during this task's read_first
 * step).
 *
 * Pure unit/decode suite — no DB, no testcontainer involvement.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsQR from "jsqr";
import QRCode from "qrcode";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  buildModuleSvg,
  InvalidColorError,
  InvalidLogoError,
  normalizeLogo,
  renderQrPng,
  renderQrSvg,
  resolveErrorCorrectionLevel,
} from "../src/lib/qr.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = "https://zack.example.com/promo";

const LOGO_PNG = { bytes: readFileSync(path.join(__dirname, "fixtures", "qr-logo.png")) };
const LOGO_SVG = { bytes: readFileSync(path.join(__dirname, "fixtures", "qr-logo.svg")) };

/**
 * Deliberately 4:1 (200x50) magenta — a colour that appears nowhere in a
 * black-on-white QR symbol, so its composited pixels can be isolated
 * exactly. Used by the PNG/SVG logo-geometry parity test below.
 */
const NON_SQUARE_LOGO = {
  bytes: await sharp({
    create: { width: 200, height: 50, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer(),
};

/** Rasterization/rounding slack between the two export paths, in pixels. */
const GEOMETRY_TOLERANCE_PX = 3;

/**
 * A deliberately LARGE, incompressible logo (800x800 of random RGBA noise,
 * ~1.9 MiB as PNG) — a solid-colour fixture would compress to a few hundred
 * bytes and could not distinguish "embedded the upload" from "embedded a
 * resized tile".
 */
async function largeNoisePng(): Promise<Buffer> {
  const side = 800;
  const raw = Buffer.alloc(side * side * 4);
  // Deterministic pseudo-random fill (no seeded-RNG dependency needed).
  let state = 0x12345678;
  for (let i = 0; i < raw.length; i += 4) {
    state = (state * 1664525 + 1013904223) >>> 0;
    raw[i] = state & 0xff;
    raw[i + 1] = (state >>> 8) & 0xff;
    raw[i + 2] = (state >>> 16) & 0xff;
    raw[i + 3] = 0xff;
  }
  return sharp(raw, { raw: { width: side, height: side, channels: 4 } }).png().toBuffer();
}

/**
 * Decodes an image buffer (PNG bytes, or a pre-rasterized SVG-as-PNG buffer)
 * back to its encoded QR payload string, or null if no code was found.
 * Source: 07-RESEARCH.md Code Example 2.
 */
async function decode(imageBuffer: Buffer): Promise<string | null> {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result?.data ?? null;
}

/** Pixel bounding box of NON_SQUARE_LOGO's magenta inside a rendered QR image. */
async function logoBoundingBox(
  imageBuffer: Buffer,
): Promise<{ minX: number; minY: number; width: number; height: number }> {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const isMagenta = data[i] > 200 && data[i + 1] < 80 && data[i + 2] > 200 && data[i + 3] > 200;
      if (!isMagenta) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX) throw new Error("no logo pixels found in the rendered image");
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe("dark-module color validation (SVG attribute-injection / XSS guard)", () => {
  // style.color is interpolated raw into fill="${color}" in buildModuleSvg — an unvalidated
  // value could break out of the attribute and inject markup/event handlers into the exported SVG.
  const injections = [
    '#000" onload="alert(1)',
    '#000"/><script>alert(1)</script><rect fill="#000',
    "red",
    "url(#x)",
    "#12", // too short
    "#1234567", // too long
    "javascript:alert(1)",
  ];
  for (const bad of injections) {
    it(`rejects a non-hex / injection color: ${JSON.stringify(bad)}`, () => {
      expect(() => buildModuleSvg("payload", "M", { color: bad, rounded: false, moduleSizePx: 10 })).toThrow(
        InvalidColorError,
      );
    });
    it(`rejects it at the render seam too: renderQrSvg(${JSON.stringify(bad)})`, async () => {
      await expect(renderQrSvg(TARGET, { color: bad })).rejects.toBeInstanceOf(InvalidColorError);
    });
  }

  it("accepts valid #RGB and #RRGGBB hex", () => {
    expect(() => buildModuleSvg("payload", "M", { color: "#000", rounded: false, moduleSizePx: 10 })).not.toThrow();
    expect(() => buildModuleSvg("payload", "M", { color: "#17170f", rounded: false, moduleSizePx: 10 })).not.toThrow();
  });

  it("a valid color never yields attribute-breaking characters in the SVG", () => {
    const svg = buildModuleSvg("payload", "M", { color: "#17170f", rounded: false, moduleSizePx: 10 });
    // no stray double-quote-then-space (attribute breakout) or angle-bracket injection around fills
    expect(svg).not.toMatch(/fill="[^"]*"[^\s/>]/);
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/on\w+=/i);
  });
});

describe("QR decode round-trip, no logo (QR-01)", () => {
  it("decodes a PNG export back to the exact target URL", async () => {
    const png = await renderQrPng(TARGET, { color: "#17170f" });
    await expect(decode(png)).resolves.toBe(TARGET);
  });

  it("decodes an SVG export, rasterized via sharp, back to the exact target URL", async () => {
    const svg = await renderQrSvg(TARGET, { color: "#17170f" });
    const rasterized = await sharp(Buffer.from(svg)).png().toBuffer();
    await expect(decode(rasterized)).resolves.toBe(TARGET);
  });
});

describe("QR decode round-trip, WITH centered logo [BLOCKING] (QR-05)", () => {
  // NOTE: these two titles deliberately avoid the substring "decodes" (used
  // by Task 2's -t partial-verify filter, which intentionally excludes the
  // logo path until Task 3 implements compositing) — do not rename them
  // back to "decodes ..." without checking 07-03-PLAN.md Task 2's <verify>.
  it("renders a PNG export whose centered PNG logo still round-trips to the exact target URL [BLOCKING]", async () => {
    const png = await renderQrPng(TARGET, { color: "#17170f", logo: LOGO_PNG });
    await expect(decode(png)).resolves.toBe(TARGET);
  });

  it("renders an SVG export whose centered SVG-sourced logo, rasterized via sharp, still round-trips to the exact target URL [BLOCKING]", async () => {
    const svg = await renderQrSvg(TARGET, { color: "#17170f", logo: LOGO_SVG });
    const rasterized = await sharp(Buffer.from(svg)).png().toBuffer();
    await expect(decode(rasterized)).resolves.toBe(TARGET);
  });
});

describe("resolveErrorCorrectionLevel (QR-05, server-forced EC level)", () => {
  it("forces 'H' whenever a logo is present", () => {
    expect(resolveErrorCorrectionLevel(true)).toBe("H");
  });

  it("defaults to 'M' when no logo is present", () => {
    expect(resolveErrorCorrectionLevel(false)).toBe("M");
  });
});

describe("buildModuleSvg geometry (QR-06, color + rounded-module toggle)", () => {
  it("includes the chosen fill color on module rects", () => {
    const svg = buildModuleSvg(TARGET, "M", { color: "#17170f", rounded: false, moduleSizePx: 10 });
    expect(svg).toContain('fill="#17170f"');
  });

  it("sets a positive rx/ry corner radius on module rects when rounded is true", () => {
    const svg = buildModuleSvg(TARGET, "M", { color: "#17170f", rounded: true, moduleSizePx: 10 });
    expect(svg).toMatch(/rx="[1-9][0-9.]*"/);
    expect(svg).toMatch(/ry="[1-9][0-9.]*"/);
  });

  it("has no positive corner radius on module rects when rounded is false", () => {
    const svg = buildModuleSvg(TARGET, "M", { color: "#17170f", rounded: false, moduleSizePx: 10 });
    expect(svg).not.toMatch(/rx="[1-9]/);
  });
});

/**
 * IN-03: both logo render paths used to call `buildModuleSvg` (which runs
 * `QRCode.create`) and then `qrDimensionPx` (which ran `QRCode.create` again
 * on the identical payload/EC level) purely to measure the symbol — two full
 * Reed-Solomon encodes per render, on the endpoint carrying the highest rate
 * limit in the app. The dimension is already known from the matrix the SVG
 * builder just walked.
 */
describe("module-matrix encode count (IN-03)", () => {
  it("encodes the module matrix exactly once per logo PNG render", async () => {
    const createSpy = vi.spyOn(QRCode, "create");
    await renderQrPng(TARGET, { color: "#17170f", rounded: false, moduleSizePx: 10, logo: LOGO_PNG });
    expect(createSpy).toHaveBeenCalledTimes(1);
    createSpy.mockRestore();
  });

  it("encodes the module matrix exactly once per logo SVG render", async () => {
    const createSpy = vi.spyOn(QRCode, "create");
    await renderQrSvg(TARGET, { color: "#17170f", rounded: false, moduleSizePx: 10, logo: LOGO_PNG });
    expect(createSpy).toHaveBeenCalledTimes(1);
    createSpy.mockRestore();
  });
});

describe("single-geometry guarantee (PNG rasterizes the exact SVG geometry, never a second renderer)", () => {
  it("renderQrSvg's no-logo output is byte-identical to buildModuleSvg's output for the same inputs", async () => {
    const style = { color: "#17170f", rounded: true, moduleSizePx: 10 };
    const fromRenderQrSvg = await renderQrSvg(TARGET, style);
    const fromBuildModuleSvg = buildModuleSvg(TARGET, "M", style);
    expect(fromRenderQrSvg).toBe(fromBuildModuleSvg);
  });

  // The byte-identity case above only covers the NO-LOGO path, so nothing
  // caught the two export paths compositing the logo with different fit
  // semantics: the SVG path used preserveAspectRatio="...slice" (cover —
  // scale up and CROP to fill the tile) while the PNG path resized with
  // fit:"contain" (letterbox, never crop). A non-square logo therefore
  // rendered as visibly different artwork from the same stored bytes.
  it("composites a NON-SQUARE logo into the same box in both the PNG and the SVG export", async () => {
    const style = { color: "#17170f", rounded: false, moduleSizePx: 10, logo: NON_SQUARE_LOGO };

    const png = await renderQrPng(TARGET, style);
    const svg = await renderQrSvg(TARGET, style);
    const rasterizedSvg = await sharp(Buffer.from(svg)).png().toBuffer();

    const fromPng = await logoBoundingBox(png);
    const fromSvg = await logoBoundingBox(rasterizedSvg);

    // Both exports must place the logo at the same origin and give it the
    // same extent (a couple of px of rasterization/rounding slack only).
    expect(Math.abs(fromPng.width - fromSvg.width)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
    expect(Math.abs(fromPng.height - fromSvg.height)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
    expect(Math.abs(fromPng.minX - fromSvg.minX)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
    expect(Math.abs(fromPng.minY - fromSvg.minY)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);

    // Sanity: the fixture really is 4:1, so a `contain` fit must stay
    // markedly wider than it is tall. (Guards against the test passing
    // because BOTH paths were changed to crop to a square.)
    expect(fromPng.width).toBeGreaterThan(fromPng.height * 2);
  });

  // renderQrSvg base64-embedded the ORIGINAL uploaded bytes while displaying
  // them in a ~46px tile — with LOGO_DATA_MAX_LENGTH allowing a ~1.36 MiB
  // stored logo, every render.svg response carried ~1.8 MiB of base64 for a
  // thumbnail, at 120 req/min/IP. The PNG path already resized first.
  it("embeds a TILE-SIZED logo in the SVG, never the full-resolution upload", async () => {
    const largeLogo = { bytes: await largeNoisePng() };

    const svg = await renderQrSvg(TARGET, { color: "#17170f", logo: largeLogo });

    const dim = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1]);
    const base64 = /href="data:image\/png;base64,([^"]+)"/.exec(svg)?.[1];
    expect(base64).toBeTruthy();
    const embedded = Buffer.from(base64 as string, "base64");
    const meta = await sharp(embedded).metadata();

    // Resized into the square tile box, exactly as the PNG path does.
    expect(meta.width).toBe(meta.height);
    expect(meta.width as number).toBeLessThan(dim / 2);
    // And the payload actually shrank rather than merely being re-declared.
    expect(embedded.length).toBeLessThan(largeLogo.bytes.length / 10);
  });
});

describe("normalizeLogo (T-07-LOGO-MIME, magic-byte validation, not client-declared mime)", () => {
  it("rejects a buffer that is neither a valid PNG signature nor a valid SVG root", async () => {
    const invalid = Buffer.from("not an image, not svg, just plain garbage text");
    await expect(normalizeLogo({ bytes: invalid })).rejects.toThrow();
  });

  // normalizeLogo is the SINGLE funnel every logo byte passes through, so
  // every rejection it can produce must be typed. Input it *recognises* but
  // sharp cannot actually decode used to escape as a plain Error, which
  // updateQrCode rethrows and the PATCH handler never caught -> 500.
  it("rejects a PNG-signature-prefixed buffer with a corrupt body as InvalidLogoError, not a raw Error", async () => {
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const corrupt = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(64, 0x41)]);
    await expect(normalizeLogo({ bytes: corrupt })).rejects.toBeInstanceOf(InvalidLogoError);
  });

  it("rejects an SVG declaring dimensions beyond the rasterization pixel limit as InvalidLogoError", async () => {
    const hugeSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="60000" height="60000">' +
        '<rect width="60000" height="60000" fill="#000000"/></svg>',
    );
    await expect(normalizeLogo({ bytes: hugeSvg })).rejects.toBeInstanceOf(InvalidLogoError);
  });
});
