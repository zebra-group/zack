import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { envSchema } from "../src/env.js";

/**
 * Drift guard (D-07): `.env.example` must document exactly the set of
 * keys the Zod schema requires — no more, no less. Fails loudly if a
 * new required var is added to the schema without documenting it (or
 * vice versa), so the operator-facing "configured only via environment
 * variables" promise (INFRA-02) never silently rots.
 */

const ENV_EXAMPLE_PATH = fileURLToPath(new URL("../../../.env.example", import.meta.url));

/**
 * Keys documented in `.env.example` that are consumed by docker-compose's
 * `db` service init (POSTGRES_*) — used to bootstrap the Postgres container
 * and to compose `DATABASE_URL` — NOT by the API process itself. The API
 * reads only the single `DATABASE_URL` connection string, so these are
 * intentionally absent from `envSchema` (adding them as required would break
 * API boot when a full `DATABASE_URL` is supplied directly). They must still
 * be documented in the one operator-facing env file (INFRA-02). Any OTHER
 * undocumented-in-schema key still fails the drift guard below.
 */
const COMPOSE_ONLY_KEYS = new Set(["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]);

function parseEnvExampleKeys(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0]?.trim())
    .filter((key): key is string => Boolean(key));
}

describe(".env.example / envSchema drift guard", () => {
  it("documents exactly the set of keys the schema requires", () => {
    const content = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
    const documentedKeys = new Set(parseEnvExampleKeys(content));
    const schemaKeys = new Set(Object.keys(envSchema.shape));

    const missingFromExample = [...schemaKeys].filter((key) => !documentedKeys.has(key));
    const extraInExample = [...documentedKeys].filter(
      (key) => !schemaKeys.has(key) && !COMPOSE_ONLY_KEYS.has(key),
    );
    // Compose-only keys are allowed in the example, but they must actually be
    // present — removing them would break `docker compose up`, so the guard
    // stays meaningful in both directions.
    const missingComposeKeys = [...COMPOSE_ONLY_KEYS].filter((key) => !documentedKeys.has(key));

    expect(missingFromExample).toEqual([]);
    expect(extraInExample).toEqual([]);
    expect(missingComposeKeys).toEqual([]);
  });

  it("does not contain a real DATABASE_URL credential (placeholder only)", () => {
    const content = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
    const line = content.split("\n").find((l) => l.startsWith("DATABASE_URL="));

    expect(line).toBeDefined();
    // Placeholder credentials only — "changeme" is the documented
    // placeholder password, never a real secret.
    expect(line).toContain("changeme");
  });
});
