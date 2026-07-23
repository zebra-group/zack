/**
 * OIDC/SSO integration suite (AUTH-06, AUTH-07, D-10-03, D-10-04) — the two
 * headline safety guarantees this phase's morning review exists to check.
 *
 * Mirrors `auth.integration.test.ts`'s `buildApp({ prisma })` +
 * `setupFileEach.ts` transaction-wrapped-DB pattern (real testcontainers
 * Postgres) and its `lib/mailer.ts` mock — the magic-link half of every test
 * here reuses that exact helper shape. Nothing about better-auth's own
 * OAuth2 state/token/session issuance is mocked; only the EXTERNAL IdP is
 * stubbed, via a tiny loopback `node:http` server started per-test that
 * serves a minimal OIDC discovery document plus token/userinfo endpoints
 * (T-10-DISCOVERY-TARGET, T-10-SSO-SESSION — no live external IdP is ever
 * touched, per this plan's `<read_first>` instruction and 10-CONTEXT.md's
 * "stand up a stub/mock OIDC discovery+token endpoint" guidance).
 *
 * Two describe blocks:
 *   1. OIDC env UNSET — proves the D-10-03 structural default: no
 *      `genericOAuth` plugin means no `/sign-in/oauth2` endpoint at all
 *      (404, not an auth failure), and magic-link is completely unchanged.
 *   2. OIDC env SET (via `vi.stubEnv`, restored in `afterEach`) — proves
 *      magic-link STILL works once SSO is active (the "unchanged" half the
 *      first block cannot cover), and drives the REAL `genericOAuth`
 *      sign-in -> callback round trip end-to-end so better-auth's own
 *      provisioning code creates the User row — never a hand-rolled
 *      `prisma.user.create` — asserting the D-10-04 least-privilege
 *      guarantee holds even when the stub IdP's userinfo response carries
 *      admin-shaped claims (`role`, `groups`, `admin`) that this codebase
 *      never maps to `accountRole` (Phase 9's `input: false` on
 *      `additionalFields.accountRole` blocks it at the better-auth
 *      provider-profile-parsing layer itself — see
 *      `db/schema.mjs#parseAdditionalUserInputFromProviderProfile` in the
 *      installed `better-auth@1.6.23` source, verified this session).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { buildApp } from "../src/app.js";
import { seedInitialAdmin } from "../src/lib/admin-seed.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { SSO_PROVIDER_ID } from "../src/lib/ssoConfig.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const ADMIN_EMAIL = "admin@kurzly.test";
const STUB_ACCESS_TOKEN = "stub-access-token";

type FastifyTestApp = Awaited<ReturnType<typeof buildApp>>;

/** Joins one or more raw `Set-Cookie` headers into a single `Cookie` header value (verbatim from auth.integration.test.ts). */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/** Extracts the `token` query param from a captured magic-link verify URL (verbatim from auth.integration.test.ts). */
function extractToken(magicLinkUrl: string): string {
  const token = new URL(magicLinkUrl).searchParams.get("token");
  if (!token) {
    throw new Error(`No token found in magic-link URL: ${magicLinkUrl}`);
  }
  return token;
}

/** Requests a magic link for `email` and returns the captured verify URL (verbatim from auth.integration.test.ts, CR-02 params). */
async function requestMagicLinkUrl(app: FastifyTestApp, email: string): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
  });
  const call = vi.mocked(sendMagicLinkEmail).mock.calls.at(-1);
  const url = call?.[0]?.url;
  if (!url) {
    throw new Error(`sendMagicLinkEmail was not called for ${email}`);
  }
  return url;
}

/**
 * Runs the full magic-link round trip (request -> verify -> get-session) and
 * asserts it succeeds for `email` — the reusable "magic-link still works"
 * assertion shared by both the OIDC-unset and OIDC-set describe blocks
 * (AUTH-06's "unchanged" half and its "while SSO is active" half).
 */
async function assertMagicLinkRoundTripSucceeds(app: FastifyTestApp, email: string): Promise<void> {
  const magicLinkUrl = await requestMagicLinkUrl(app, email);
  const token = extractToken(magicLinkUrl);

  const verifyRes = await app.inject({
    method: "GET",
    url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  });
  expect(verifyRes.statusCode).toBe(200);
  expect(verifyRes.json()?.user?.email).toBe(email);

  const cookieHeader = toCookieHeader(verifyRes.headers["set-cookie"]);
  const sessionRes = await app.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie: cookieHeader },
  });
  expect(sessionRes.statusCode).toBe(200);
  expect(sessionRes.json()?.user?.email).toBe(email);
}

interface OidcStubOptions {
  /** Subject claim (`sub`) the stub userinfo endpoint returns. */
  sub: string;
  /** Email claim the stub userinfo endpoint returns — becomes the provisioned User's email. */
  email: string;
  /** Extra claims merged into the userinfo response (e.g. admin-shaped role/groups/admin claims for the no-claim-elevation proof). */
  extraClaims?: Record<string, unknown>;
}

interface OidcStub {
  /** The stub's own base URL — set as `OIDC_ISSUER_URL` so `ssoDiscoveryUrl()` derives `{issuer}/.well-known/openid-configuration`. */
  issuer: string;
  close: () => Promise<void>;
}

/**
 * Starts a hermetic, in-process OIDC provider stub on a loopback port:
 * discovery document + token endpoint + userinfo endpoint. Never touches a
 * live external IdP (T-10-DISCOVERY-TARGET stays "accept" — issuer is
 * operator-trusted config — but this stub proves the wiring without
 * depending on any real network egress in CI).
 */
function startOidcStub(options: OidcStubOptions): Promise<OidcStub> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const issuer = issuerUrl();
      const url = new URL(req.url ?? "/", issuer);

      if (url.pathname === "/.well-known/openid-configuration") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
          }),
        );
        return;
      }

      if (url.pathname === "/token" && req.method === "POST") {
        // No id_token in the response (D-10-05 discipline: production config
        // sets no getToken/getUserInfo overrides), so better-auth's callback
        // handler falls through to fetching the discovery userinfo_endpoint
        // below rather than decoding a JWT — the realistic path for a
        // provider whose token response omits id_token.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: STUB_ACCESS_TOKEN,
            token_type: "Bearer",
            expires_in: 3600,
          }),
        );
        return;
      }

      if (url.pathname === "/userinfo") {
        if (req.headers.authorization !== `Bearer ${STUB_ACCESS_TOKEN}`) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_token" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sub: options.sub,
            email: options.email,
            email_verified: true,
            name: "SSO Stub User",
            ...options.extraClaims,
          }),
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });

    function issuerUrl(): string {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("OIDC stub server has no bound loopback address yet");
      }
      return `http://127.0.0.1:${address.port}`;
    }

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        issuer: issuerUrl(),
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

/**
 * Drives the REAL `genericOAuth` sign-in -> callback round trip: initiates
 * sign-in (capturing the `state` param + the state-verification cookie
 * better-auth sets), then hits the callback with a fabricated authorization
 * `code` (the stub token endpoint doesn't validate it) and the SAME state +
 * cookie — exactly the request shape a browser redirect would produce.
 * Never hand-creates a User row; better-auth's own provisioning code
 * (`oauth2/link-account.mjs#handleOAuthUserInfo`) is what runs.
 */
async function ssoSignInAndCallback(
  app: FastifyTestApp,
): Promise<Awaited<ReturnType<FastifyTestApp["inject"]>>> {
  const signInRes = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/oauth2",
    payload: { providerId: SSO_PROVIDER_ID, callbackURL: "/", errorCallbackURL: "/auth/error" },
  });
  if (signInRes.statusCode !== 200) {
    throw new Error(
      `OIDC sign-in initiation failed (${signInRes.statusCode}): ${signInRes.body}`,
    );
  }
  const { url } = signInRes.json() as { url: string };
  const state = new URL(url).searchParams.get("state");
  if (!state) {
    throw new Error(`No state param in OIDC authorization URL: ${url}`);
  }
  const cookieHeader = toCookieHeader(signInRes.headers["set-cookie"]);

  return app.inject({
    method: "GET",
    url: `/api/auth/oauth2/callback/${SSO_PROVIDER_ID}?code=stub-authorization-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: cookieHeader },
  });
}

describe("OIDC/SSO not configured — structural default (AUTH-06, D-10-03)", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    vi.mocked(sendMagicLinkEmail).mockClear();
    await seedInitialAdmin(prisma, ADMIN_EMAIL);
  });

  it("POST /api/auth/sign-in/oauth2 is 404 — no genericOAuth endpoints exist when OIDC env is unset", async () => {
    const app = await buildApp({ prisma });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/oauth2",
      payload: { providerId: SSO_PROVIDER_ID },
    });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("magic-link sign-in still works exactly as before when OIDC env is unset", async () => {
    const app = await buildApp({ prisma });

    await assertMagicLinkRoundTripSucceeds(app, ADMIN_EMAIL);

    await app.close();
  });
});

describe("OIDC/SSO configured — genericOAuth registered (AUTH-06 coexistence, AUTH-07 least-privilege, D-10-04)", () => {
  let stub: OidcStub | undefined;

  beforeEach(async () => {
    vi.mocked(sendMagicLinkEmail).mockClear();
    await seedInitialAdmin(prisma, ADMIN_EMAIL);
  });

  afterEach(async () => {
    if (stub) {
      await stub.close();
      stub = undefined;
    }
    vi.unstubAllEnvs();
  });

  async function buildAppWithOidc(options: OidcStubOptions): Promise<FastifyTestApp> {
    stub = await startOidcStub(options);
    vi.stubEnv("OIDC_ISSUER_URL", stub.issuer);
    vi.stubEnv("OIDC_CLIENT_ID", "test-oidc-client-id");
    vi.stubEnv("OIDC_CLIENT_SECRET", "test-oidc-client-secret");
    return buildApp({ prisma });
  }

  it("AUTH-06 coexistence: magic-link round trip still succeeds while genericOAuth is registered", async () => {
    const app = await buildAppWithOidc({
      sub: "sso-coexistence-subject",
      email: "sso.coexistence@idp.test",
    });

    await assertMagicLinkRoundTripSucceeds(app, ADMIN_EMAIL);

    await app.close();
  });

  it("AUTH-07: a user provisioned through the real OIDC callback path gets accountRole member and zero DomainMemberships", async () => {
    const email = "sso.new-user@idp.test";
    const app = await buildAppWithOidc({ sub: "sso-least-privilege-subject", email });

    const callbackRes = await ssoSignInAndCallback(app);
    expect(callbackRes.statusCode).toBe(302);
    expect(callbackRes.headers.location).not.toContain("error=");

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user?.accountRole).toBe("member");

    const memberships = await prisma.domainMembership.findMany({ where: { userId: user!.id } });
    expect(memberships).toHaveLength(0);

    await app.close();
  });

  it("AUTH-07 no-claim-elevation: admin-shaped IdP claims (role/groups/admin) never elevate the provisioned user", async () => {
    const email = "sso.admin-claims@idp.test";
    const app = await buildAppWithOidc({
      sub: "sso-no-elevation-subject",
      email,
      extraClaims: { role: "admin", groups: ["admins", "owners"], admin: true },
    });

    const callbackRes = await ssoSignInAndCallback(app);
    expect(callbackRes.statusCode).toBe(302);
    expect(callbackRes.headers.location).not.toContain("error=");

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user?.accountRole).toBe("member");

    const memberships = await prisma.domainMembership.findMany({ where: { userId: user!.id } });
    expect(memberships).toHaveLength(0);

    await app.close();
  });
});
