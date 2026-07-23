/**
 * ssoConfig unit suite (Phase 10, 10-01-PLAN.md Task 1, D-10-01/02/06/07).
 *
 * `lib/ssoConfig.ts` is the single source of truth every later OIDC/SSO
 * consumer (createAuth in 10-02, the status route in 10-03) reads through —
 * this file is pure ENV-shaped-object -> value transforms with ZERO
 * database/network access, matching `test/referrer.test.ts` /
 * `test/env.test.ts`'s pure-function unit-test shape (no `setupFileEach`
 * harness needed).
 *
 * Covers:
 * - readSsoConfig: none-set -> null, partial -> null (defensive; env.ts is
 *   the actual boot guard), all-three-set -> the config object
 * - ssoDiscoveryUrl: trailing-slash normalization
 * - ssoCallbackPath: the REAL better-auth genericOAuth callback shape
 *   (D-10-06), never the prototype's /api/auth/callback/oidc guess
 * - maskClientId: never reveals the full client id
 */
import { describe, expect, it } from "vitest";
import {
  maskClientId,
  readSsoConfig,
  SSO_PROVIDER_ID,
  ssoCallbackPath,
  ssoDiscoveryUrl,
} from "../src/lib/ssoConfig.js";

describe("readSsoConfig (D-10-07, all-three-or-none reader)", () => {
  it("returns null when none of the three OIDC vars are set", () => {
    expect(readSsoConfig({})).toBeNull();
  });

  it("returns null when only OIDC_ISSUER_URL is set", () => {
    expect(readSsoConfig({ OIDC_ISSUER_URL: "https://idp.example.com" })).toBeNull();
  });

  it("returns null when only OIDC_ISSUER_URL and OIDC_CLIENT_ID are set (defensive — env.ts is the real boot guard)", () => {
    expect(
      readSsoConfig({
        OIDC_ISSUER_URL: "https://idp.example.com",
        OIDC_CLIENT_ID: "client-abc",
      }),
    ).toBeNull();
  });

  it("returns the config object when all three OIDC vars are set", () => {
    const result = readSsoConfig({
      OIDC_ISSUER_URL: "https://idp.example.com",
      OIDC_CLIENT_ID: "client-abc",
      OIDC_CLIENT_SECRET: "super-secret-value",
    });

    expect(result).toEqual({
      issuer: "https://idp.example.com",
      clientId: "client-abc",
      clientSecret: "super-secret-value",
    });
  });
});

describe("ssoDiscoveryUrl (D-10-01)", () => {
  it("appends the standard OIDC discovery suffix to an issuer with no trailing slash", () => {
    expect(ssoDiscoveryUrl("https://idp.example.com")).toBe(
      "https://idp.example.com/.well-known/openid-configuration",
    );
  });

  it("normalizes a trailing slash on the issuer before appending the discovery suffix", () => {
    expect(ssoDiscoveryUrl("https://idp.example.com/")).toBe(
      "https://idp.example.com/.well-known/openid-configuration",
    );
  });
});

describe("ssoCallbackPath (D-10-06, the REAL better-auth callback shape)", () => {
  it("yields {BASE_URL}/api/auth/oauth2/callback/{SSO_PROVIDER_ID} — never the prototype's /api/auth/callback/oidc guess", () => {
    expect(ssoCallbackPath("https://kurzly.example.com")).toBe(
      `https://kurzly.example.com/api/auth/oauth2/callback/${SSO_PROVIDER_ID}`,
    );
  });

  it("strips a trailing slash on baseUrl before appending the callback path", () => {
    expect(ssoCallbackPath("https://kurzly.example.com/")).toBe(
      `https://kurzly.example.com/api/auth/oauth2/callback/${SSO_PROVIDER_ID}`,
    );
  });
});

describe("SSO_PROVIDER_ID", () => {
  it("is the fixed provider id 'oidc' shared by auth.ts registration and the callback path", () => {
    expect(SSO_PROVIDER_ID).toBe("oidc");
  });
});

describe("maskClientId (UI-10-06, never reveal the full client id)", () => {
  it("never returns the input unchanged for a realistic client id", () => {
    const clientId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(maskClientId(clientId)).not.toBe(clientId);
  });

  it("keeps a short prefix and suffix with the middle replaced", () => {
    const clientId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const masked = maskClientId(clientId);
    expect(masked.startsWith(clientId.slice(0, 4))).toBe(true);
    expect(masked.endsWith(clientId.slice(-4))).toBe(true);
    expect(masked).toContain("...");
    expect(masked).not.toContain(clientId.slice(8, -8));
  });

  it("never reveals the full value for a very short id (only the first character shown)", () => {
    const clientId = "abc";
    const masked = maskClientId(clientId);
    expect(masked).not.toBe(clientId);
    expect(masked.startsWith("a")).toBe(true);
  });
});
