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
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildModuleSvg,
  normalizeLogo,
  renderQrPng,
  renderQrSvg,
  resolveErrorCorrectionLevel,
} from "../src/lib/qr.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = "https://kurzly.example.com/promo";

const LOGO_PNG = { bytes: readFileSync(path.join(__dirname, "fixtures", "qr-logo.png")) };
const LOGO_SVG = { bytes: readFileSync(path.join(__dirname, "fixtures", "qr-logo.svg")) };

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
  it("decodes a PNG export WITH a centered PNG logo back to the exact target URL", async () => {
    const png = await renderQrPng(TARGET, { color: "#17170f", logo: LOGO_PNG });
    await expect(decode(png)).resolves.toBe(TARGET);
  });

  it("decodes an SVG export WITH a centered SVG-sourced logo, rasterized via sharp, back to the exact target URL", async () => {
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

describe("single-geometry guarantee (PNG rasterizes the exact SVG geometry, never a second renderer)", () => {
  it("renderQrSvg's no-logo output is byte-identical to buildModuleSvg's output for the same inputs", async () => {
    const style = { color: "#17170f", rounded: true, moduleSizePx: 10 };
    const fromRenderQrSvg = await renderQrSvg(TARGET, style);
    const fromBuildModuleSvg = buildModuleSvg(TARGET, "M", style);
    expect(fromRenderQrSvg).toBe(fromBuildModuleSvg);
  });
});

describe("normalizeLogo (T-07-LOGO-MIME, magic-byte validation, not client-declared mime)", () => {
  it("rejects a buffer that is neither a valid PNG signature nor a valid SVG root", async () => {
    const invalid = Buffer.from("not an image, not svg, just plain garbage text");
    await expect(normalizeLogo({ bytes: invalid })).rejects.toThrow();
  });
});
