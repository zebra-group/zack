/**
 * SSO status endpoint (AUTH-05, D-10-02, D-10-06, T-10-SECRET-LEAK,
 * T-10-NO-CRED-FORM) — the single server-authoritative read-only surface
 * both the Team screen's "Authentifizierung" OIDC card (10-04) and the
 * login screen's SSO affordance (10-05) consume, so neither re-derives SSO
 * state itself.
 *
 * `ssoRoute()` is a Fastify-plugin FACTORY mirroring `tlsCheckRoute`'s
 * shape — no session/cookie is read or required (T-10-STATUS-ANON): the
 * login screen needs the `enabled` flag BEFORE the caller is authenticated,
 * and `issuer`/`clientIdMasked`/`callbackPath` are all non-secret,
 * OAuth-public values, so gating them behind a session would only add
 * complexity without closing any real information-disclosure gap.
 *
 * This is a status + setup-guidance surface, NOT a credential-entry
 * endpoint (D-10-02) — there is deliberately no POST/PUT/PATCH here that
 * accepts issuer/client-id/client-secret from the browser. OIDC
 * configuration is ENV-only (D-10-07); adding a mutation route here is
 * explicitly out of scope (T-10-NO-CRED-FORM).
 *
 * The handler NEVER reads, selects, or returns `OIDC_CLIENT_SECRET` in any
 * branch (T-10-SECRET-LEAK) — `SsoStatusDTO` (`@kurzly/shared`)
 * structurally has no secret field, and both `issuer`/`clientIdMasked` and
 * `callbackPath` are derived exclusively through `lib/ssoConfig.ts`'s
 * `readSsoConfig()`/`maskClientId()`/`ssoCallbackPath()` — the SAME module
 * `createAuth` (10-02) reads, so the callback path returned here can never
 * drift from the one better-auth actually registered (T-10-CONFIG-DRIFT).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SsoStatusDTO } from "@kurzly/shared";
import { maskClientId, readSsoConfig, ssoCallbackPath } from "../lib/ssoConfig.js";

export function ssoRoute() {
  return async function registerSsoRoute(app: FastifyInstance): Promise<void> {
    app.get("/api/sso/status", async (_request: FastifyRequest, reply: FastifyReply) => {
      const sso = readSsoConfig();
      const callbackPath = ssoCallbackPath(process.env.BASE_URL as string);

      const body: SsoStatusDTO = sso
        ? {
            enabled: true,
            issuer: sso.issuer,
            clientIdMasked: maskClientId(sso.clientId),
            callbackPath,
          }
        : {
            enabled: false,
            issuer: null,
            clientIdMasked: null,
            callbackPath,
          };

      return reply.send(body);
    });
  };
}
