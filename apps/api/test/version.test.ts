/**
 * lib/version.ts unit tests + GET /api/version route test (no DB —
 * mirrors qrDecode.test.ts's plain `test/*.test.ts` convention for
 * non-integration suites).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FALLBACK_VERSION, resolveAppVersion } from "../src/lib/version.js";
import { prisma } from "./setupFileEach.js";

describe("resolveAppVersion", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("reads the version field from a real package.json-shaped file", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "zack-version-"));
    const file = path.join(dir, "package.json");
    await writeFile(file, JSON.stringify({ name: "zack", version: "1.2.3" }));

    expect(await resolveAppVersion(file)).toBe("1.2.3");
  });

  it("degrades to FALLBACK_VERSION when the file is missing (e.g. `pnpm dev` outside the built image)", async () => {
    expect(await resolveAppVersion("/no/such/path/package.json")).toBe(FALLBACK_VERSION);
  });

  it("degrades to FALLBACK_VERSION when the file is not valid JSON", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "zack-version-"));
    const file = path.join(dir, "package.json");
    await writeFile(file, "not json");

    expect(await resolveAppVersion(file)).toBe(FALLBACK_VERSION);
  });

  it("degrades to FALLBACK_VERSION when the parsed JSON has no version field", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "zack-version-"));
    const file = path.join(dir, "package.json");
    await writeFile(file, JSON.stringify({ name: "zack" }));

    expect(await resolveAppVersion(file)).toBe(FALLBACK_VERSION);
  });
});

describe("GET /api/version", () => {
  it("returns a version string, degrading to FALLBACK_VERSION outside the built Docker image", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "GET", url: "/api/version" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: FALLBACK_VERSION });

    await app.close();
  });
});
