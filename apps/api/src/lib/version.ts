/**
 * Deployed app version (AppShell.vue's sidebar footer, self-hosted D-01
 * UI). Reads the root `package.json`'s `version` field baked into the
 * runtime image at build time (Dockerfile COPY) — the SAME value
 * semantic-release just bumped and tagged before the Docker build ran
 * in the same CI job (`ci.yml`'s release job runs `semantic-release`
 * BEFORE the build-and-push steps, against the same checkout), so this
 * is always exactly the version of the image actually running, never a
 * hand-maintained UI literal that silently drifts from what's really
 * deployed.
 *
 * Mirrors `lib/geoip.ts`'s never-throws-degrade shape: a missing file
 * (e.g. running `pnpm dev` outside the built Docker image, where the
 * Dockerfile's COPY never ran) resolves to `FALLBACK_VERSION` rather
 * than crashing boot or the route that serves it.
 */
import { readFile } from "node:fs/promises";

export const DEFAULT_VERSION_FILE_PATH = "/prod/api/root-package.json";
export const FALLBACK_VERSION = "0.0.0-dev";

export async function resolveAppVersion(filePath: string = DEFAULT_VERSION_FILE_PATH): Promise<string> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
