/**
 * better-auth instance factory (AUTH-01..04, D-01, D-02b).
 *
 * `createAuth(prisma)` is a factory — mirrors `routes/canary.ts`'s
 * `canaryRoute(prisma)` pattern (RESEARCH Pattern 4/Standard Stack
 * convention) — so callers supply the Prisma client the instance's
 * `prismaAdapter` and the D-01 allowlist check (`isEmailAllowed`) both
 * query through. Production (`app.ts`'s default path) wires `db.ts`'s
 * singleton via the `auth` export below (Single-client discipline,
 * Pitfall 2, T-02-02 — never a second ad hoc `PrismaClient`). Tests
 * (02-04 Task 3, `auth.integration.test.ts`) wire the SAME
 * transaction-wrapped client `test/setupFileEach.ts` uses via
 * `buildApp({ prisma })` (D-09) — without this factory, the `auth`
 * singleton would always be bound to `db.ts`'s default client, which
 * points at a placeholder/unreachable `DATABASE_URL` under Vitest AND
 * (even if pointed at the real testcontainers URL) would run on a
 * SEPARATE physical connection whose writes are invisible to — and never
 * rolled back with — the test's own BEGIN/ROLLBACK transaction.
 *
 * `prismaAdapter` comes from the BUNDLED `better-auth/adapters/prisma`
 * import (re-exports the first-party `@better-auth/prisma-adapter`
 * package, which ships as a transitive dependency of `better-auth` itself
 * — see 02-01-SUMMARY.md and RESEARCH.md OQ-2's resolution).
 * `@better-auth/prisma-adapter` is deliberately NOT a direct dependency of
 * `apps/api/package.json`.
 *
 * `magicLink()` is the ONLY login plugin (no email/password, no SSO in
 * this phase). `disableSignUp: true` blocks auto-creation of a `User` row
 * on verify — combined with the in-callback allowlist check below
 * (`isEmailAllowed`), this implements D-01's invite-only, neutral-response
 * policy: `sendMagicLink` fires for every request regardless of allowlist
 * status and returns silently (no throw, no distinguishable response) for
 * a non-allowlisted email, so better-auth's own HTTP response is
 * byte-identical either way (verified empirically in 02-04's canary test,
 * RESEARCH.md OQ-1).
 *
 * `BASE_URL`/`BETTER_AUTH_SECRET` are read directly from `process.env`
 * (not `loadEnv()`) for the same reason `db.ts` and `lib/mailer.ts` do —
 * this module is only imported after `server.ts`'s boot-time `loadEnv()`
 * has already validated the full environment; re-validating here would
 * crash any test that imports this module without the full ENV surface
 * set (see `vitest.config.ts`).
 *
 * Phase 10 (AUTH-05/06/07, D-10-01/03/04/05): `genericOAuth` (from
 * `better-auth/plugins` — the installed 1.6.23 does not ship an `sso`
 * plugin, D-10-01) is pushed onto `plugins` ONLY when `readSsoConfig()`
 * (`lib/ssoConfig.ts`, 10-01) returns non-null, i.e. only when
 * `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` are all set
 * (D-10-03). On a magic-link-only install the `plugins` array is
 * `[magicLink()]` exactly as before this phase — no `/api/auth/oauth2/*`
 * or `/api/auth/sign-in/oauth2` endpoints exist at all, so
 * "magic-link keeps working unchanged" (AUTH-06) is a structural property,
 * not something enforced by extra code. `discoveryUrl` is the ONLY
 * endpoint source configured (`ssoDiscoveryUrl(sso.issuer)`) — no
 * `authorizationUrl`/`tokenUrl`/`userInfoUrl` overrides — so the operator
 * supplies just the issuer and better-auth discovers the
 * authorization/token/userinfo endpoints itself (D-10-01's issuer-only
 * ergonomics). Deliberately NO `mapProfileToUser` (or any option that
 * writes `accountRole`/domain access): mapping IdP claims to privilege is
 * an explicit non-goal (D-10-04) — combined with `user.additionalFields
 * .accountRole`'s existing `input: false` below (which better-auth's own
 * `parseAdditionalUserInputFromProviderProfile` also honors for OAuth
 * profile fields, verified this session against the installed 1.6.23
 * source), a provisioned SSO user can never carry `accountRole` in from
 * the IdP — it always lands on the DB column default, `member`, with zero
 * `DomainMembership` rows. Confirmed against the installed 1.6.23 source
 * that `genericOAuth` needs no new `Account` columns (D-10-05) — it
 * writes only the fields the `Account` model already has (`providerId`,
 * `accountId`, `accessToken`, `refreshToken`, `idToken`, `scope`), so no
 * migration was needed for this plan.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { genericOAuth, magicLink } from "better-auth/plugins";
import { prisma as defaultPrisma } from "../db.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { isEmailAllowed } from "./allowlist.js";
import { sendMagicLinkEmail } from "./mailer.js";
import { readSsoConfig, ssoDiscoveryUrl, SSO_PROVIDER_ID } from "./ssoConfig.js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set — auth.ts must only be imported after env validation.`);
  }
  return value;
}

export function createAuth(prisma: PrismaClient) {
  // D-10-03: read once per instance construction; registers genericOAuth
  // ONLY when all three OIDC env vars are present (readSsoConfig's
  // all-three-or-none contract, D-10-07). Absent -> `sso` is null -> the
  // plugins array below stays exactly `[magicLink()]`, unchanged from
  // pre-Phase-10 behavior.
  const sso = readSsoConfig();

  return betterAuth({
    baseURL: requireEnv("BASE_URL"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    // Phase 9 (D-09-01, UI-09-02, T-09-ROLE-MASS): the `accountRole` column
    // already exists (plain additive Prisma migration, apps/api/src/lib/
    // accountRole.ts) — no `@better-auth/cli generate` schema-sync step is
    // needed, since this block only teaches the Prisma adapter to READ an
    // existing column into the get-session/get-user response, never to
    // create one. `input: false` keeps it non-client-settable through any
    // auth/signup/update-user path — defense-in-depth alongside
    // `disableSignUp: true` below, so the only writers of accountRole are
    // admin-seed.ts and the admin-gated team routes (09-04).
    user: {
      additionalFields: {
        accountRole: { type: "string", required: false, input: false },
      },
    },
    session: {
      // 7-day sliding session (AUTH-03): survives a browser refresh, and the
      // 1-day `updateAge` refreshes the expiry on activity rather than
      // forcing a hard 7-day logout.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // CR-06 (11-REVIEW.md, discovered via live E2E testing against the
    // built image — never surfaced by fastify.inject unit tests, which run
    // under NODE_ENV=test): better-auth's OWN core rate limiter defaults to
    // `enabled: options.rateLimit?.enabled ?? isProduction` (create-context.mjs)
    // — i.e. ON by default specifically under NODE_ENV=production, the exact
    // env this app boots under (D-01/INFRA-01). The `magicLink()` plugin
    // additionally registers its own independent rule (`window: 60, max: 5`
    // on `/sign-in/magic-link`, plugins/magic-link/index.mjs) gated by the
    // SAME master `ctx.rateLimit.enabled` switch (api/rate-limiter/index.mjs:
    // `if (!ctx.rateLimit.enabled) return`). Both were silently active in
    // production all along, completely independent of and invisible to this
    // project's own deliberate, reviewed, per-route Fastify-level limiter
    // (`plugins/rateLimit.ts`'s `MAGIC_LINK_RATE_LIMIT`, 5 req/15min) — a
    // second, undocumented, unreviewed 5-req/60s gate stacked underneath it.
    // This surfaced as a real bug (INFRA-06): the E2E `x-e2e-bypass` header
    // only ever exempted the Fastify-level limiter, so better-auth's own
    // internal one kept 429-ing regardless. Rather than teach a SECOND
    // limiter about the bypass secret (doubling the maintenance/security
    // surface this project's code reviews already flagged once for drift,
    // CR-05), disable better-auth's redundant internal rate limiting
    // entirely — `plugins/rateLimit.ts` remains the single, intentional,
    // security-reviewed source of truth for every auth endpoint's rate
    // limiting, in every environment.
    rateLimit: {
      enabled: false,
    },
    plugins: [
      magicLink({
        expiresIn: 900, // 15 minutes — AUTH-02
        disableSignUp: true, // D-01 — no auto-signup, invite-only
        sendMagicLink: async ({ email, url }) => {
          // D-01 neutral response: the allowlist check lives INSIDE this
          // callback, never in a separate pre-check route (T-02-01). A
          // non-allowlisted email returns silently — no throw, no error
          // object — so better-auth's own response to the client is
          // byte-identical to the allowlisted path.
          const allowed = await isEmailAllowed(prisma, email);
          if (!allowed) return;
          // WR-01 fix: better-auth `await`s this callback before responding
          // to the client, so awaiting the SMTP send here would make an
          // allowlisted email's response measurably slower than a
          // non-allowlisted one (which returns right after the single fast
          // DB lookup above) — a timing side-channel that leaks account
          // existence, exactly what this module's header comment and
          // `lib/allowlist.ts`'s own comment call out as unacceptable.
          // Fire-and-forget instead: the mail send still happens, but the
          // response no longer waits on it, so both branches return in
          // comparable wall-clock time. Errors are logged, not thrown —
          // throwing here would surface as a distinguishable non-200
          // response, reintroducing the same leak this fix closes.
          void sendMagicLinkEmail({ to: email, url }).catch((error: unknown) => {
            console.error(`Failed to send magic-link email to ${email}:`, error);
          });
        },
      }),
      // D-10-03: registered only when OIDC is configured, so a
      // magic-link-only install exposes no /api/auth/oauth2/* endpoints
      // (AUTH-06). No mapProfileToUser — see this file's header comment
      // (D-10-04): claim-to-privilege mapping is an explicit non-goal.
      //
      // WR-01 (10-REVIEW) ratified — NOT a defect. Unlike magic-link
      // (invite-only, `disableSignUp: true` + the `isEmailAllowed` gate
      // above, D-01), SSO deliberately has NO signup gate / allowlist:
      // auto-provisioning a NEWLY-authenticated IdP user is REQUIRED by the
      // spec (AUTH-07 / ROADMAP success criterion 3 — "a user newly created
      // via SSO automatically receives the Member role"). The invite-only
      // invariant (D-01) applies to magic-link, which has no external
      // identity authority; SSO intentionally delegates admission control to
      // the operator's own configured IdP. The risk is bounded by the
      // least-privilege default: a self-provisioned SSO user lands on
      // `accountRole: "member"` (the DB column default, non-settable via
      // `input: false` above — the IdP cannot inject a role claim) with ZERO
      // DomainMembership rows, so they can see/do nothing until an admin
      // assigns domains. Adding a `disableImplicitSignUp` gate here would
      // BREAK success criterion 3 — do not add one.
      ...(sso
        ? [
            genericOAuth({
              config: [
                {
                  providerId: SSO_PROVIDER_ID,
                  discoveryUrl: ssoDiscoveryUrl(sso.issuer),
                  clientId: sso.clientId,
                  clientSecret: sso.clientSecret,
                  // AUTH-E2E-04 fix (13-07-PLAN.md, empirically discovered by
                  // 13-01's live round trip against a real, spec-compliant
                  // mock IdP): without an explicit `scopes` array, better-auth
                  // sends the authorization request with `scope=` (empty) --
                  // `genericOAuth`'s own default is `[]`, not `["openid"]`.
                  // The permissive hand-rolled stub in
                  // sso-auth.integration.test.ts never validates the
                  // requested scope, so this gap was invisible there; a
                  // real OIDC provider's default interaction policy requires
                  // at least the `openid` scope and denies consent
                  // (`error=access_denied`) otherwise -- confirmed live via
                  // apps/e2e/tests/auth/sso.spec.ts before this fix landed.
                  // `email`/`profile` are additionally requested so the
                  // userinfo response includes the claims this app's
                  // provisioning path (`email`) and profile-completeness
                  // (`name`) already expect.
                  scopes: ["openid", "email", "profile"],
                },
              ],
            }),
          ]
        : []),
    ],
  });
}

export const auth = createAuth(defaultPrisma);
