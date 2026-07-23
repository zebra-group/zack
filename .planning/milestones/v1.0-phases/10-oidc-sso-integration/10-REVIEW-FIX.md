---
phase: 10-oidc-sso-integration
fixed_at: 2026-07-23T19:05:00Z
review_path: .planning/phases/10-oidc-sso-integration/10-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 4
skipped: 3
status: partial
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-07-23T19:05:00Z
**Source review:** .planning/phases/10-oidc-sso-integration/10-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (fix_scope = all)
- Fixed / addressed: 4 (CR-01, WR-01, WR-02, IN-02)
- Skipped: 3 (IN-01, IN-03, IN-04)

All fixes followed the mandatory TDD flow (failing `test(...)` commit first,
then `fix(...)`) per project rules. Worktrees are disabled — work was done
directly on `master`. Repo-wide `pnpm -r exec tsc --noEmit` is clean; the
affected test files pass (`apps/api/test/env.test.ts`: 16/16;
`apps/web/test/LoginView.test.ts`: 10/10).

## Fixed Issues

### CR-01: `.env.example` verbatim copy bricks boot — "empty = SSO off" contract was false

**Files modified:** `apps/api/src/env.ts`, `apps/api/test/env.test.ts`
**Commits:** `1b13cfd` (failing test), `12132a0` (fix)
**Applied fix:** Fixed at the ROOT in `parseEnv()`. Added an explicit
`OPTIONAL_ENV_KEYS` list (all `.optional()` vars) and, before Zod validation,
normalized any empty-string OR whitespace-only value on those keys to "unset"
(delete the key) so `KEY=` behaves as absent everywhere — matching
`readSsoConfig`'s `!issuer` semantics and the documented contract. This also
repairs the identical latent defect on `GEOIP_DB_PATH` and
`CLICK_RETENTION_DAYS`. REQUIRED keys are deliberately excluded from the list,
so an empty required var (e.g. `DATABASE_URL=`) still fails loudly through its
own validator (pinned by a regression test). No schema shape change, so the
`envSchema.shape` introspection tests (env-example-drift / env) are unaffected.

Regression tests added: verbatim-empty OIDC trio → success + SSO off;
whitespace-only OIDC → SSO off; partial config (empty issuer + set id/secret)
→ still the all-three-or-none boot error naming the missing key; empty
GEOIP/retention → feature-off; empty required `DATABASE_URL` → still fails.

**Note:** The optional `.env.example` defense-in-depth change (commenting out
the OIDC lines) was NOT applied — `.env.example` is permission-blocked from
this agent's reads/edits. The load-bearing fix (env.ts normalization) does not
require editing `.env.example` and fully resolves the boot break on its own.

### WR-01: SSO self-provisions any IdP-authenticated user — ratified as intended (not a defect)

**Files modified:** `apps/api/src/lib/auth.ts` (clarifying comment only, no behavior change)
**Commit:** `e0de2fa`
**Applied fix:** Ratified per instruction — this is INTENTIONAL and REQUIRED by
the spec (AUTH-07 / ROADMAP success criterion 3: "a user newly created via SSO
automatically receives the Member role"). Adding a `disableImplicitSignUp`
gate would BREAK that criterion, so no signup gate was added. Instead, a
clarifying comment was added next to the `genericOAuth` registration recording
that SSO auto-provisioning is intentional (the invite-only D-01 invariant
applies to magic-link, which has no external identity authority; SSO delegates
admission control to the operator's configured IdP), and that the risk is
bounded by the least-privilege default — `accountRole: "member"` (DB default,
non-settable via `input: false`, so the IdP cannot inject a role claim) with
zero DomainMemberships until an admin assigns domains. **Ratified — intended
per AUTH-07/criterion 3, bounded by least-privilege default; not a defect.**

### WR-02: `signInWithSso` omitted `errorCallbackURL` — reintroduced the silent-bounce failure CR-02 fixed

**Files modified:** `apps/web/src/views/LoginView.vue`, `apps/web/test/LoginView.test.ts`
**Commits:** `ef776e5` (failing test), `63fd445` (fix)
**Applied fix:** Added `errorCallbackURL: "/auth/error"` to the
`/api/auth/sign-in/oauth2` request body, mirroring the magic-link CR-02 fix in
the same file. A failed OAuth callback (IdP denies, state mismatch,
discovery/token error) now routes to the dedicated no-leak `/auth/error`
screen instead of silently bouncing back to "/". The `LoginView.test.ts`
assertion was updated to pin the exact body shape.

### IN-02: `LoginView` bypassed the typed `getSsoStatus()` client

**Files modified:** `apps/web/src/views/LoginView.vue`
**Commit:** `3b6ddb1`
**Applied fix:** Replaced the hand-rolled `fetch("/api/sso/status")` +
untyped `.json()` in `loadSsoStatus` with the typed `getSsoStatus()` client
(the same one `TeamView` uses — an intra-package import, no cross-package
risk). A non-ok response now throws `ApiError`, caught in the existing
`catch` as fail-closed exactly as before (UI-10-08). Existing LoginView tests
(fail-closed on network throw, fail-closed on 500, enabled path) all still
pass unchanged.

## Skipped Issues

### IN-01: `SSO_PROVIDER_ID` duplicated as a magic string in the frontend

**File:** `apps/web/src/views/LoginView.vue:30`
**Reason:** Skipped as disproportionate for an INFO item. LoginView already
declares the value as a single named local constant
(`const SSO_PROVIDER_ID = "oidc"`) with an explicit "both sides must always
agree" comment — the bare-inline-magic-string concern is already mitigated.
The only remaining single-source improvement (export the id from
`@kurzly/shared` and import it on both sides) would introduce a RUNTIME
cross-package value import from `@kurzly/shared`, for which there is **no
precedent in the codebase** — both `apps/api` and `apps/web` currently use
`import type` exclusively for that package. Introducing the first value import
(plus a shared rebuild and a backend `ssoConfig.ts` refactor) to chase an INFO
finding risks the web build/type resolution for little gain, against the
explicit "do NOT create a cross-package import that breaks the web build /
keep it proportionate" guidance.
**Original issue:** The frontend `SSO_PROVIDER_ID = "oidc"` re-declares the
server-side `ssoConfig.ts` constant; if the provider id changes server-side,
the sign-in POST would silently target a non-existent provider.

### IN-03: `/api/sso/status` discloses issuer + masked client id to anonymous callers

**File:** `apps/api/src/routes/sso.ts:35-53`
**Reason:** Skipped — accepted design (T-10-STATUS-ANON), not a defect. The
anonymous surface is a deliberate, documented decision: the login screen needs
the `enabled` flag pre-auth, and `issuer`/masked-client-id/`callbackPath` are
non-secret OAuth-public values (they appear in the authorize redirect). The
actual security boundary — the masked client id and the structurally-absent
client secret — holds. Narrowing the anonymous payload was flagged by the
reviewer itself as optional hardening, low impact.
**Original issue:** The route returns `issuer`/`clientIdMasked` to every
unauthenticated caller while the only pre-auth consumer reads just `enabled`.

### IN-04: `process.env.BASE_URL as string` type-assertion in the status handler

**File:** `apps/api/src/routes/sso.ts:37`
**Reason:** Skipped — low priority and not a trivial/safe change. This route
reads raw `process.env` by design (mirroring `lib/ssoConfig.ts`'s documented
convention of reading `process.env` directly rather than the parsed
`loadEnv()` result, because it may run before/without full boot-time
validation). `BASE_URL` is env-validated as required (`z.url()`), so the
assertion cannot fire on a normal boot. Threading the validated `Env` into
this anonymous plugin route is more than a trivial edit and out of proportion
for an INFO finding; the reviewer explicitly marked it "low priority, if
touched."
**Original issue:** `ssoCallbackPath(process.env.BASE_URL as string)` would
throw a `TypeError` (→ 500) if `BASE_URL` were unset; the cast hides the
assumption rather than enforcing it.

---

_Fixed: 2026-07-23T19:05:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
