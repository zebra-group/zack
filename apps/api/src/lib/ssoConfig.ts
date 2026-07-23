/**
 * Single source of truth for OIDC/SSO configuration (D-10-01/02/06/07).
 *
 * Both `createAuth` (`apps/api/src/lib/auth.ts`, 10-02) and the SSO status
 * route (`apps/api/src/routes/sso.ts`, 10-03) import THIS module rather than
 * reading `process.env` directly for OIDC — so the registered `genericOAuth`
 * callback path and the path surfaced to the operator in the admin UI can
 * never drift apart (T-10-CONFIG-DRIFT).
 *
 * Follows `lib/auth.ts`'s own convention (see that file's header comment):
 * reads `process.env` directly rather than `loadEnv()`'s parsed result,
 * because this module may be imported by code paths (and tests) that run
 * before/without the full boot-time ENV validation. `env.ts`'s
 * all-three-or-none guard (D-10-07) is the actual boot-time enforcement —
 * `readSsoConfig` below is a DEFENSIVE second check so a partial config can
 * never half-enable SSO even if some future caller bypasses `loadEnv()`.
 */

/** Fixed provider id registered with `genericOAuth` and used to derive the callback path — both sides always agree (D-10-06). */
export const SSO_PROVIDER_ID = "oidc";

export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Reads OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET directly from the
 * given env-shaped source (defaults to `process.env`). Returns the config
 * ONLY when all three are non-empty strings — absence of all three means
 * SSO is off (mirrors `GEOIP_DB_PATH`'s absence=feature-off pattern,
 * `env.ts` lines 98-107); a partial set returns `null` here too, even
 * though `env.ts`'s boot guard (D-10-07) already refuses to boot on a
 * partial config — this reader must never itself half-enable SSO.
 */
export function readSsoConfig(env: NodeJS.ProcessEnv = process.env): SsoConfig | null {
  const issuer = env.OIDC_ISSUER_URL;
  const clientId = env.OIDC_CLIENT_ID;
  const clientSecret = env.OIDC_CLIENT_SECRET;

  if (!issuer || !clientId || !clientSecret) {
    return null;
  }

  return { issuer, clientId, clientSecret };
}

/**
 * Standard OIDC discovery document URL for a given issuer (D-10-01) — the
 * admin supplies only the issuer, `genericOAuth`'s `discoveryUrl` option
 * discovers the authorization/token/jwks endpoints itself.
 */
export function ssoDiscoveryUrl(issuer: string): string {
  const normalized = issuer.replace(/\/+$/, "");
  return `${normalized}/.well-known/openid-configuration`;
}

/**
 * The REAL better-auth `genericOAuth` callback URL for `SSO_PROVIDER_ID`
 * (D-10-06) — verified this session against the installed
 * `better-auth@1.6.23` source: `generic-oauth/routes.mjs` builds its
 * redirect/callback URL as `${ctx.context.baseURL}/oauth2/callback/${providerId}`,
 * and better-auth's own `getBaseURL` resolves `ctx.context.baseURL` as the
 * configured `baseURL` (i.e. our `BASE_URL` env var) joined with the
 * default `basePath` of `/api/auth` (`createAuth` never overrides
 * `basePath`). So the real, registerable callback shape is
 * `{BASE_URL}/api/auth/oauth2/callback/oidc` — NOT the design handoff's
 * prototype-era guess of `/api/auth/callback/oidc`.
 */
export function ssoCallbackPath(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return `${normalized}/api/auth/oauth2/callback/${SSO_PROVIDER_ID}`;
}

/**
 * Masks a client id so the full value is never fully visible (UI-10-06) —
 * keeps a short prefix/suffix with the middle replaced by an ellipsis. For
 * very short ids (<= 8 chars, where a prefix+suffix would reveal the whole
 * thing or nearly so) only the first character is revealed.
 */
export function maskClientId(clientId: string): string {
  if (clientId.length <= 8) {
    return `${clientId.slice(0, 1)}...`;
  }
  return `${clientId.slice(0, 4)}...${clientId.slice(-4)}`;
}
