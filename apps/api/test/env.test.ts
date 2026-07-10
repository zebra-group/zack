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
  SMTP_FROM: "Kurzly <no-reply@example.com>",
  BASE_URL: "https://kurzly.example.com",
  BETTER_AUTH_SECRET: "a".repeat(32),
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
