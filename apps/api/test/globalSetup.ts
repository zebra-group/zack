/**
 * Real-Postgres TDD harness — Vitest globalSetup (D-09, RESEARCH Pattern 5).
 *
 * Starts ONE shared `postgres:18-alpine` testcontainer for the whole
 * `vitest run` invocation, applies the committed migration to it (so every
 * test sees the real, up-to-date schema — no mocked Prisma), and hands its
 * connection URI to every worker/test file via Vitest's `provide`/`inject`
 * context (see the `ProvidedContext` augmentation below).
 *
 * Defaulting to a single shared container rather than a container-per-worker
 * setup: RESEARCH Pitfall 5 / Open Question 1 notes that Vitest's
 * `globalSetup` runs once per `vitest` invocation by default (not once per
 * worker or per file), so "one container per worker" collapses to "one
 * shared container" unless `poolOptions` is deliberately tuned — which this
 * phase's test volume does not yet justify. `test/db.diagnostic.test.ts`
 * empirically confirms this (A3) by logging `process.pid`.
 *
 * Per-test isolation (BEGIN/ROLLBACK) is layered on top in
 * `test/setupFileEach.ts`, not here — globalSetup only owns the
 * container/schema lifecycle.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const prismaBin = path.join(apiRoot, "node_modules", ".bin", "prisma");

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const dbUrl = container.getConnectionUri();

  // Apply the committed migration to the fresh container so every test
  // runs against the real, current schema (D-09 — no Prisma mocking).
  execFileSync(prismaBin, ["migrate", "deploy"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "inherit",
  });

  project.provide("dbUrl", dbUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
