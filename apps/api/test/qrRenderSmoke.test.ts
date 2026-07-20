import sharp from "sharp";
import { describe, expect, it } from "vitest";

/**
 * [BLOCKING] sharp image-pipeline smoke test (07-02 Task 3).
 *
 * De-risks two Assumptions Log items from 07-RESEARCH.md before the 07-03
 * decode-round-trip test depends on them:
 *   - A5: sharp's bundled SVG rasterization works on this host/platform
 *     (no separate librsvg dependency needed at this Node/sharp version).
 *   - A4: sharp's `.raw()` pixel output has the exact RGBA shape
 *     (`data.length === width * height * 4`) that jsQR's decode API expects.
 *
 * Pure smoke test — no DB, no testcontainer involvement — its only job is
 * to fail loudly here (Wave 2) rather than deep inside the 07-03 renderer
 * if sharp's SVG/raw pipeline is unavailable on the host.
 */
describe("sharp image pipeline smoke test (A4/A5)", () => {
  const width = 40;
  const height = 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#d7ff01"/></svg>`;

  it("rasterizes a trivial inline SVG string to a PNG buffer without throwing (A5)", async () => {
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    expect(Buffer.isBuffer(pngBuffer)).toBe(true);
    expect(pngBuffer.length).toBeGreaterThan(0);
    // PNG magic bytes.
    expect(pngBuffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("produces raw RGBA pixels whose shape matches width*height*4 (A4)", async () => {
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    const { data, info } = await sharp(pngBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(width);
    expect(info.height).toBe(height);
    expect(info.channels).toBe(4);
    expect(data.length).toBe(info.width * info.height * 4);
  });
});
