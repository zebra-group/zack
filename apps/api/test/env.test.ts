import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fail-fast ENV validation contract (D-06, INFRA-02).
 *
 * `parseEnv()` is a pure function so it can be exercised directly without
 * killing the test runner. `loadEnv()` is the thin boot wrapper every
 * process entrypoint calls — on invalid input it prints the formatted
 * Zod issues to stderr and calls `process.exit(1)` instead of throwing,
 * so a misconfigured operator env fails loudly and immediately at boot
 * rather than crashing cryptically deep inside a DB/SMTP call later.
 */

const VALID_SOURCE: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  PORT: "4000",
  DATABASE_URL: "postgresql://kurzly:secret@db:5432/kurzly",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_SECURE: "true",
  SMTP_USER: "smtp-user",
  SMTP_PASS: "smtp-pass",
  SMTP_FROM: "no-reply@example.com",
  BASE_URL: "https://kurzly.example.com",
  BETTER_AUTH_SECRET: "a".repeat(32),
  INITIAL_ADMIN_EMAIL: "admin@example.com",
};

describe("parseEnv()", () => {
  it("returns a typed object with coerced values on a complete valid source", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv(VALID_SOURCE);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.PORT).toBe(4000);
    expect(typeof result.data.PORT).toBe("number");
    expect(result.data.SMTP_SECURE).toBe(true);
    expect(typeof result.data.SMTP_SECURE).toBe("boolean");
    expect(result.data.DATABASE_URL).toBe(VALID_SOURCE.DATABASE_URL);
  });

  it("fails with the offending key when DATABASE_URL is missing", async () => {
    const { parseEnv } = await import("../src/env.js");
    const { DATABASE_URL, ...rest } = VALID_SOURCE;

    const result = parseEnv(rest);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("DATABASE_URL");
  });

  it("rejects a BETTER_AUTH_SECRET shorter than 32 chars", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({ ...VALID_SOURCE, BETTER_AUTH_SECRET: "too-short" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("BETTER_AUTH_SECRET");
  });

  it("rejects the .env.example placeholder BETTER_AUTH_SECRET even though it is >= 32 chars (WR-06)", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      BETTER_AUTH_SECRET: "changeme-generate-a-real-32-plus-char-secret",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("BETTER_AUTH_SECRET");
  });

  it("rejects a non-URL DATABASE_URL and a non-email SMTP_FROM", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      DATABASE_URL: "not-a-url",
      SMTP_FROM: "not-an-email",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("DATABASE_URL");
    expect(paths).toContain("SMTP_FROM");
  });
});

describe("parseEnv() — OIDC/SSO all-three-or-none boot guard (D-10-07)", () => {
  it("succeeds when none of the three OIDC vars are set (SSO off)", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv(VALID_SOURCE);

    expect(result.success).toBe(true);
  });

  it("succeeds when all three OIDC vars are set, and the values are present on the parsed result", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      OIDC_ISSUER_URL: "https://idp.example.com",
      OIDC_CLIENT_ID: "client-abc",
      OIDC_CLIENT_SECRET: "secret-xyz",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.OIDC_ISSUER_URL).toBe("https://idp.example.com");
    expect(result.data.OIDC_CLIENT_ID).toBe("client-abc");
    expect(result.data.OIDC_CLIENT_SECRET).toBe("secret-xyz");
  });

  it("fails with an issue naming the missing OIDC key(s) when only OIDC_ISSUER_URL is set", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      OIDC_ISSUER_URL: "https://idp.example.com",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("OIDC_CLIENT_ID");
    expect(paths).toContain("OIDC_CLIENT_SECRET");
  });

  it("fails with an issue naming the missing OIDC key when two of three are set", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      OIDC_ISSUER_URL: "https://idp.example.com",
      OIDC_CLIENT_ID: "client-abc",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("OIDC_CLIENT_SECRET");
    expect(paths).not.toContain("OIDC_ISSUER_URL");
    expect(paths).not.toContain("OIDC_CLIENT_ID");
  });
});

describe("parseEnv() — empty/whitespace optional vars normalize to unset (CR-01)", () => {
  it("boots with SSO OFF when all three OIDC vars are present but empty (verbatim .env.example copy)", async () => {
    const { parseEnv } = await import("../src/env.js");

    // Reproduces the documented copy-.env.example-verbatim workflow: dotenv
    // turns `OIDC_ISSUER_URL=` into `""` (not undefined), and `.optional()`
    // only admits undefined — so the empty strings must be normalized to
    // "not set" BEFORE Zod runs, or the whole boot (magic-link included)
    // fails on a var the operator never intended to configure.
    const result = parseEnv({
      ...VALID_SOURCE,
      OIDC_ISSUER_URL: "",
      OIDC_CLIENT_ID: "",
      OIDC_CLIENT_SECRET: "",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.OIDC_ISSUER_URL).toBeUndefined();
    expect(result.data.OIDC_CLIENT_ID).toBeUndefined();
    expect(result.data.OIDC_CLIENT_SECRET).toBeUndefined();
  });

  it("treats whitespace-only optional OIDC vars as unset (SSO off)", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      OIDC_ISSUER_URL: "   ",
      OIDC_CLIENT_ID: "\t",
      OIDC_CLIENT_SECRET: " ",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.OIDC_ISSUER_URL).toBeUndefined();
  });

  it("still enforces all-three-or-none when one OIDC var is empty and the other two are set (partial config)", async () => {
    const { parseEnv } = await import("../src/env.js");

    // An empty issuer normalizes to unset, leaving id+secret set — this is a
    // PARTIAL config and must remain the clear all-three-or-none boot error,
    // not a silently half-enabled SSO path.
    const result = parseEnv({
      ...VALID_SOURCE,
      OIDC_ISSUER_URL: "",
      OIDC_CLIENT_ID: "client-abc",
      OIDC_CLIENT_SECRET: "secret-xyz",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("OIDC_ISSUER_URL");
    expect(paths).not.toContain("OIDC_CLIENT_ID");
    expect(paths).not.toContain("OIDC_CLIENT_SECRET");
  });

  it("normalizes the same latent defect for GEOIP_DB_PATH and CLICK_RETENTION_DAYS (empty = feature off)", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      GEOIP_DB_PATH: "",
      CLICK_RETENTION_DAYS: "",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.GEOIP_DB_PATH).toBeUndefined();
    expect(result.data.CLICK_RETENTION_DAYS).toBeUndefined();
  });

  it("does NOT weaken a REQUIRED var — an empty DATABASE_URL still fails loudly", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({ ...VALID_SOURCE, DATABASE_URL: "" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("DATABASE_URL");
  });
});

describe("parseEnv() — E2E_RATE_LIMIT_BYPASS_SECRET production boot guard (WR-03, CR-02)", () => {
  it("is not a key of envSchema.shape (unchanged from before this fix)", async () => {
    const { envSchema } = await import("../src/env.js");

    expect(Object.keys(envSchema.shape)).not.toContain("E2E_RATE_LIMIT_BYPASS_SECRET");
  });

  it("fails loudly when NODE_ENV=production and E2E_RATE_LIMIT_BYPASS_SECRET is set", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      NODE_ENV: "production",
      E2E_RATE_LIMIT_BYPASS_SECRET: "leaked-secret",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("E2E_RATE_LIMIT_BYPASS_SECRET");
  });

  it("succeeds when NODE_ENV=production and E2E_RATE_LIMIT_BYPASS_SECRET is absent", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({ ...VALID_SOURCE, NODE_ENV: "production" });

    expect(result.success).toBe(true);
  });

  it("succeeds when E2E_RATE_LIMIT_BYPASS_SECRET is set but NODE_ENV is NOT production", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      NODE_ENV: "development",
      E2E_RATE_LIMIT_BYPASS_SECRET: "some-dev-secret",
    });

    expect(result.success).toBe(true);
  });

  it("treats a whitespace-only E2E_RATE_LIMIT_BYPASS_SECRET as absent (not a false-positive boot failure)", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      NODE_ENV: "production",
      E2E_RATE_LIMIT_BYPASS_SECRET: "   ",
    });

    expect(result.success).toBe(true);
  });

  // CR-05 (11-REVIEW.md iteration 2): docker-compose.e2e.yml deliberately
  // boots the built image with NODE_ENV=production (INFRA-01) AND a real
  // E2E_RATE_LIMIT_BYPASS_SECRET (INFRA-06) at the same time — exactly the
  // shape this guard used to reject unconditionally, crash-looping the
  // entire E2E stack on every boot. E2E_COMPOSE_OVERLAY is the narrow,
  // independent signal that lets this exact merged-env shape boot
  // successfully without reopening the original CR-02/WR-03 hole for real
  // production deployments (which never set this marker either).
  it("succeeds when NODE_ENV=production, E2E_RATE_LIMIT_BYPASS_SECRET is set, AND E2E_COMPOSE_OVERLAY is present (the real docker-compose.e2e.yml merged env shape)", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      NODE_ENV: "production",
      E2E_RATE_LIMIT_BYPASS_SECRET: "leaked-secret",
      E2E_COMPOSE_OVERLAY: "true",
    });

    expect(result.success).toBe(true);
  });

  it("still fails loudly when E2E_COMPOSE_OVERLAY is empty/whitespace-only (not a real E2E-overlay boot)", async () => {
    const { parseEnv } = await import("../src/env.js");

    const result = parseEnv({
      ...VALID_SOURCE,
      NODE_ENV: "production",
      E2E_RATE_LIMIT_BYPASS_SECRET: "leaked-secret",
      E2E_COMPOSE_OVERLAY: "   ",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const paths = result.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("E2E_RATE_LIMIT_BYPASS_SECRET");
  });

  it("does not require E2E_COMPOSE_OVERLAY to be a documented envSchema key (stays absent, mirrors E2E_RATE_LIMIT_BYPASS_SECRET)", async () => {
    const { envSchema } = await import("../src/env.js");

    expect(Object.keys(envSchema.shape)).not.toContain("E2E_COMPOSE_OVERLAY");
  });
});

describe("loadEnv() (fail-fast boot wrapper)", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("process.exit called");
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("calls process.exit(1) and prints formatted issues when parse fails", async () => {
    const { loadEnv } = await import("../src/env.js");
    const { DATABASE_URL, ...invalidSource } = VALID_SOURCE;

    expect(() => loadEnv(invalidSource)).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns the typed env without calling process.exit on valid input", async () => {
    const { loadEnv } = await import("../src/env.js");

    const result = loadEnv(VALID_SOURCE);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(result.PORT).toBe(4000);
  });
});
