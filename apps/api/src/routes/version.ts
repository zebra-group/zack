/**
 * GET /api/version — the actual deployed release version (see
 * lib/version.ts's header comment). No session/auth required: it leaks
 * no more than the GHCR image tag itself already publicly documents.
 */
import type { FastifyInstance } from "fastify";
import type { VersionInfo } from "@zack/shared";
import { resolveAppVersion } from "../lib/version.js";

export async function versionRoute(app: FastifyInstance): Promise<void> {
  app.get("/version", async (): Promise<VersionInfo> => ({ version: await resolveAppVersion() }));
}
