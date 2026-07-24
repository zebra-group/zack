/**
 * Mock OIDC Identity Provider for the E2E-only docker-compose.e2e.yml
 * overlay (13-01-PLAN.md, T-13-SC/T-13-01/T-13-02). Wraps `oidc-provider`
 * (vetted 9.10.0, panva/node-oidc-provider) with:
 *
 *   - a discovery-document rewrite so `authorization_endpoint` alone is
 *     advertised on the host-published address while `issuer`/
 *     `token_endpoint`/`userinfo_endpoint`/`jwks_uri` stay on the
 *     Docker-internal address `app` actually calls server-to-server
 *     (13-RESEARCH.md Pattern 1 -- dual-reachability problem);
 *   - an auto-approve `/interaction/:uid` route so NO login/consent HTML
 *     form is ever rendered (out of scope per REQUIREMENTS.md -- this mock
 *     proves the OAuth contract, not a third-party IdP's own UI);
 *   - `PUT`/`DELETE /__test__/profile`, a test-fixture-only control surface
 *     (T-13-01, accepted risk -- published ONLY on this E2E-only image) so
 *     Playwright specs can toggle the next authenticated subject's
 *     sub/email/emailVerified/extraClaims (e.g. admin-shaped `role`/`admin`
 *     claims for AUTH-E2E-04's no-elevation proof) before driving the
 *     browser through the SSO button.
 *
 * IMPLEMENTATION NOTES (deviations from 13-RESEARCH.md Pattern 1's
 * illustrative example, discovered empirically while building this file --
 * verified live against the actual installed oidc-provider@9.10.0, not
 * assumed):
 *
 *   1. `Provider` (from the `oidc-provider` package) already IS the Koa
 *      app -- do NOT wrap it inside a second `new Koa()` and mount
 *      `provider.callback()` as if it were Koa middleware. `callback()`
 *      returns a raw Node `(req, res)` HTTP listener, not `(ctx, next)`
 *      middleware; mounting it that way throws
 *      `TypeError: res argument is required`. All custom routes and
 *      response-rewrite middleware are registered directly on `provider`
 *      via `provider.use(...)`, which oidc-provider overrides to always
 *      insert new middleware immediately before its own internal action
 *      router -- exactly the hook point the discovery/userinfo rewrite
 *      below needs (`await next()` runs the real OIDC action first, then
 *      the rewrite inspects/mutates the response).
 *   2. The default interaction policy has TWO prompts for any OIDC-scoped
 *      request: `login`, then `consent`. Auto-approving only `login` (as
 *      13-RESEARCH.md's illustrative snippet showed) leaves the flow stuck
 *      resubmitting a `consent` interaction forever. This handler resolves
 *      BOTH prompts in one auto-approving route, granting whatever
 *      scopes/claims the request asked for via a `provider.Grant`.
 *   3. `findAccount().claims()`'s `extraClaims` would otherwise be silently
 *      stripped from the real `/me` (userinfo) response by oidc-provider's
 *      own claims-scope filtering (arbitrary keys like `role`/`admin` are
 *      not part of any configured `openid`/`email`/`profile` claims list,
 *      so `Grant#getOIDCClaimsFiltered` never grants them). A second
 *      rewrite merges `extraClaims` directly into the userinfo response
 *      body, bypassing that filter -- otherwise AUTH-E2E-04's admin-shaped
 *      claims would never reach the app at all, and the "still provisions
 *      member" assertion would be proving nothing.
 *
 * Confirmed via a live authorization_code round trip against the installed
 * 9.10.0 package during implementation: `ctx.oidc.route === "discovery"`
 * (Q2) and `ctx.oidc.route === "userinfo"` are the correct route names
 * (`ctx.oidc.route` is `ctx._matchedRouteName`, set by the internal
 * `@koa/router` from the name each action is registered under); default
 * route paths are `/auth`, `/token`, `/me` (A1);
 * `interactionDetails(req, res)` / `interactionFinished(req, res, result,
 * opts)` take the raw Koa `ctx.req`/`ctx.res` (A2).
 */
import Provider from "oidc-provider";
import Router from "@koa/router";

const INTERNAL_URL = process.env.OIDC_MOCK_INTERNAL_URL;
const PUBLIC_URL = process.env.OIDC_MOCK_PUBLIC_URL;
const PORT = process.env.OIDC_MOCK_PORT;

const DEFAULT_PROFILE = {
  sub: "sso-default-subject",
  email: "sso.user@idp.test",
  emailVerified: true,
  extraClaims: {},
};

/** The next account's claims -- set via PUT, reset via DELETE /__test__/profile. */
let nextProfile = { ...DEFAULT_PROFILE };

const provider = new Provider(INTERNAL_URL, {
  clients: [
    {
      client_id: process.env.OIDC_MOCK_CLIENT_ID,
      client_secret: process.env.OIDC_MOCK_CLIENT_SECRET,
      redirect_uris: [process.env.OIDC_MOCK_REDIRECT_URI],
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
  ],
  claims: { openid: ["sub"], email: ["email", "email_verified"], profile: ["name"] },
  // No built-in dev login/consent views -- our own auto-approve
  // `/interaction/:uid` route below is the ONLY interaction surface;
  // testing an IdP's own login UI is explicitly out of scope.
  features: { devInteractions: { enabled: false } },
  findAccount(_ctx, id) {
    return {
      accountId: id,
      async claims() {
        return {
          sub: id,
          email: nextProfile.email,
          email_verified: nextProfile.emailVerified ?? true,
          name: "SSO Test User",
          ...nextProfile.extraClaims,
        };
      },
    };
  },
});

async function readJsonBody(ctx) {
  const chunks = [];
  for await (const chunk of ctx.req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const router = new Router();

router.put("/__test__/profile", async (ctx) => {
  const body = await readJsonBody(ctx);
  nextProfile = {
    sub: body.sub ?? nextProfile.sub,
    email: body.email ?? nextProfile.email,
    emailVerified: body.emailVerified ?? nextProfile.emailVerified,
    extraClaims: body.extraClaims ?? {},
  };
  ctx.status = 204;
});

router.delete("/__test__/profile", async (ctx) => {
  nextProfile = { ...DEFAULT_PROFILE, extraClaims: {} };
  ctx.status = 204;
});

// Auto-approve EVERY interaction prompt (login, then consent) with the
// current test-controlled subject -- no HTML form is ever rendered.
router.get("/interaction/:uid", async (ctx) => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);
  const { prompt, params, session } = details;

  if (prompt.name === "login") {
    await provider.interactionFinished(
      ctx.req,
      ctx.res,
      { login: { accountId: nextProfile.sub } },
      { mergeWithLastSubmission: false },
    );
    return;
  }

  // "consent" -- auto-grant whatever scopes/claims this request asked for
  // rather than rendering a consent screen.
  const grant = new provider.Grant({ accountId: session.accountId, clientId: params.client_id });
  if (params.scope) grant.addOIDCScope(params.scope);
  if (prompt.details.missingOIDCClaims) grant.addOIDCClaims(prompt.details.missingOIDCClaims);
  const grantId = await grant.save();

  await provider.interactionFinished(
    ctx.req,
    ctx.res,
    { consent: { grantId } },
    { mergeWithLastSubmission: true },
  );
});

// Response rewrite -- registered via `provider.use`, which oidc-provider
// positions immediately before its own internal action router, so
// `await next()` runs the real discovery/userinfo action first and this
// middleware inspects/mutates the finished response.
provider.use(async (ctx, next) => {
  await next();

  if (ctx.oidc?.route === "discovery" && ctx.status === 200) {
    ctx.body.authorization_endpoint = ctx.body.authorization_endpoint.replace(INTERNAL_URL, PUBLIC_URL);
  }

  if (ctx.oidc?.route === "userinfo" && ctx.status === 200 && ctx.body && typeof ctx.body === "object") {
    Object.assign(ctx.body, nextProfile.extraClaims);
  }
});

provider.use(router.routes());
provider.use(router.allowedMethods());

provider.listen(PORT, () => {
  // eslint-disable-next-line no-console -- container stdout is the only log sink here
  console.log(`[oidc-mock] listening on :${PORT} (issuer=${INTERNAL_URL}, public=${PUBLIC_URL})`);
});
