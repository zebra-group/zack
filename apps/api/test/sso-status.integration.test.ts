/**
 * SSO status endpoint integration suite (AUTH-05, D-10-02, D-10-06,
 * T-10-SECRET-LEAK, T-10-NO-CRED-FORM) — proves `GET /api/sso/status` is a
 * strictly read-only status+guidance surface: the correct
 * `SsoStatusDTO` shape for both the disabled and enabled states, the REAL
 * better-auth callback path (never the design handoff's prototype-era
 * `/api/auth/callback/oidc` guess), and — the security-critical assertion —
 * that the OIDC client secret NEVER appears anywhere in the response, in
 * either its raw or parsed form.
 *
 * Mirrors `sso-auth.integration.test.ts`'s `buildApp({ prisma })` +
 * `setupFileEach.ts` transaction-wrapped-DB pattern and its
 * `vi.stubEnv`/`vi.unstubAllEnvs` OIDC-env-toggling convention. No session
 * is required — this route is read before authentication (the login screen
 * needs `enabled` pre-auth, T-10-STATUS-ANON) — so no admin seeding or
 * cookie plumbing is needed here, unlike the magic-link/OIDC round-trip
 * suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { ssoCallbackPath } from "../src/lib/ssoConfig.js";
import { prisma } from "./setupFileEach.js";

const STATUS_URL = "/api/sso/status";

describe("GET /api/sso/status — disabled (no OIDC env, D-10-02/UI-10-04)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
  });

  it("returns 200 with enabled:false, null issuer/clientIdMasked, and a present real callbackPath", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "GET", url: STATUS_URL });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      enabled: false,
      issuer: null,
      clientIdMasked: null,
      callbackPath: ssoCallbackPath(process.env.BASE_URL as string),
    });
    expect(body.callbackPath.length).toBeGreaterThan(0);
    expect(body.callbackPath).not.toBe("/api/auth/callback/oidc");

    await app.close();
  });
});

describe("GET /api/sso/status — enabled (OIDC env set, D-10-06/UI-10-05)", () => {
  const ISSUER = "https://idp.example.com";
  const CLIENT_ID = "test-oidc-client-id-value";
  const CLIENT_SECRET_SENTINEL = "super-secret-sentinel-do-not-leak-9f3a7c";

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("OIDC_ISSUER_URL", ISSUER);
    vi.stubEnv("OIDC_CLIENT_ID", CLIENT_ID);
    vi.stubEnv("OIDC_CLIENT_SECRET", CLIENT_SECRET_SENTINEL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with enabled:true, verbatim issuer, a masked (not full) client id, and the real callbackPath", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "GET", url: STATUS_URL });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.issuer).toBe(ISSUER);
    expect(body.clientIdMasked).not.toBe(CLIENT_ID);
    expect(body.clientIdMasked.length).toBeGreaterThan(0);
    expect(body.callbackPath).toBe(ssoCallbackPath(process.env.BASE_URL as string));
    expect(body.callbackPath).not.toBe("/api/auth/callback/oidc");

    await app.close();
  });

  it("T-10-SECRET-LEAK: never returns the client secret, in raw body text or any parsed key", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({ method: "GET", url: STATUS_URL });

    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain(CLIENT_SECRET_SENTINEL);

    const body = res.json() as Record<string, unknown>;
    for (const value of Object.values(body)) {
      expect(value).not.toBe(CLIENT_SECRET_SENTINEL);
    }
    expect(Object.keys(body).sort()).toEqual(
      ["callbackPath", "clientIdMasked", "enabled", "issuer"].sort(),
    );

    await app.close();
  });

  it("T-10-NO-CRED-FORM: read-only — POST /api/sso/status is not a configured mutation route", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({
      method: "POST",
      url: STATUS_URL,
      payload: {
        issuer: "https://attacker.example.com",
        clientId: "attacker-id",
        clientSecret: "attacker-secret",
      },
    });

    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
