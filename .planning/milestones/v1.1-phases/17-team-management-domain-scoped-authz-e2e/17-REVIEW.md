---
phase: 17-team-management-domain-scoped-authz-e2e
reviewed: 2026-07-25T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - apps/e2e/tests/authed/team-invite-accept.spec.ts
  - apps/e2e/tests/authed/team-role-domain-reassign.spec.ts
  - apps/e2e/tests/authed/team-member-removal.spec.ts
  - apps/e2e/tests/authed/authz-domain-denial.spec.ts
  - apps/e2e/tests/authed/authz-admin-bypass.spec.ts
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-07-25
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed all five new Playwright specs closing the v1.1 milestone's final
phase (TEAM-E2E-01/02/03, AUTHZ-E2E-01/02). Confirmed test-authoring-only
scope (zero `apps/api`/`apps/web` diffs). Cross-checked every selector and
assertion against the real source it exercises (`lib/team.ts`, `lib/
authorization.ts`, `schema.prisma`'s `Session.user onDelete: Cascade`,
`LinkDetailView.vue`/`AnalyticsView.vue` markup) — all came back accurate.

The two properties this review was asked to scrutinize hardest both hold up
well in isolation, with one real exception:

- **"Immediate" revocation** (`team-member-removal.spec.ts`): genuinely
  asserted on the FIRST subsequent request, no polling/retry loop anywhere —
  `get-session` is read exactly once post-removal and a DB cross-check
  (`user.count`/`session.count === 0`) backs it. No masking risk found.
- **Zero-`DomainMembership` precondition before the bypass claim**
  (`authz-admin-bypass.spec.ts`): genuinely asserted explicitly
  (`domainMembership.count === 0`) BEFORE the fixture/navigation, not merely
  assumed. Solid.
- **The `storageState: undefined` + own-context `.request` fix** (discovered
  in 17-02 as a genuine test-harness bug: `browser.newContext()` under a
  storageState-bearing project silently inherits that project's session
  cookie): applied correctly and consistently in `team-role-domain-
  reassign.spec.ts`, `team-member-removal.spec.ts`, and `authz-domain-
  denial.spec.ts` — **but missing in `team-invite-accept.spec.ts`** (written
  in 17-01, before the bug was discovered, and never retroactively patched).
  See CR-01.

Beyond that, the recurring cross-phase debt from 14/15/16-REVIEW.md's IN-01
(retry/skip boilerplate duplication) is present again, and a broader
test-isolation gap emerged that's specific to this phase: unlike prior
phases, four of these five specs create real `User`/`Link`/`QrCode`/
`Domain` rows that are never truncated between spec files and are never
cleaned up by the spec itself — one of them (`team-role-domain-
reassign.spec.ts`) leaves behind a throwaway fixture account it has itself
promoted to `accountRole: "admin"`, permanently, for the remainder of the
compose session. None of the seeded baseline `ADMIN_EMAIL`/`MEMBER_EMAIL`
fixtures are touched or at risk — that specific concern is clean across all
five files.

## Critical Issues

### CR-01: `team-invite-accept.spec.ts`'s "fresh, unauthenticated" acceptance context is not actually unauthenticated — missing the `storageState: undefined` fix 17-02 established for every other file in this phase

**File:** `apps/e2e/tests/authed/team-invite-accept.spec.ts:89-108`
**Issue:** This spec's doc comment (lines 89-94) and code both claim `acceptCtx` is "a SEPARATE, fresh unauthenticated browser context." It is not:

```typescript
const acceptCtx = await browser.newContext({ baseURL: resolvedBaseUrl });
```

This test only ever runs under the `chromium-admin` project (`test.skip(testInfo.project.name !== "chromium-admin", ...)`, line 37-40), and `playwright.config.ts` declares `use.storageState: "playwright/.auth/admin.json"` for that project. Per 17-02's own documented finding (`team-role-domain-reassign.spec.ts:91-106`, confirmed live and independently re-confirmed in `team-member-removal.spec.ts` and `authz-domain-denial.spec.ts`), `browser.newContext()` silently inherits a storageState-bearing project's default `storageState` unless explicitly overridden with `storageState: undefined`. `acceptCtx` here does not override it, so it silently carries the ADMIN's session cookie into what the test believes is a brand-new, unauthenticated identity.

Grepping all five files confirms this is the *only* `browser.newContext()` call in the entire phase missing the fix (`team-role-domain-reassign.spec.ts:108`, `team-member-removal.spec.ts:101`, and `authz-domain-denial.spec.ts:122` all correctly pass `storageState: undefined`) — this file was written first (17-01), before the bug was discovered, and was never retroactively patched when the fix became established phase convention.

Concrete consequence: the subsequent assertion —
```typescript
await acceptPage.goto(magicLinkUrl);
await acceptPage.getByRole("link", { name: "Dashboard" }).waitFor();
```
— is meant to be "the concrete acceptance-fully-completed signal" (per the file's own comment), i.e., proof that the invitee's magic link specifically was verified. Because the context already carries a valid ADMIN session cookie, this assertion can no longer discriminate between "the invite's magic link was verified" and "this browser was already logged in as someone else the whole time" — e.g., if better-auth's verify handler ever redirected to `errorCallbackURL` instead of `callbackURL` (invalid/expired/mismatched token), a route guard bouncing an already-authenticated session away from an error page could still render "Dashboard," silently masking a real regression in the invite-acceptance path at exactly the checkpoint whose comment claims it's the strongest proof of that path. The test's *final* assertions (Step 4's roster status-badge flip and Step 5's direct-Prisma `emailVerified` check) are unaffected by this contamination and would still independently catch a genuinely broken flow — so this does not currently produce a false-green full-test result — but it violates the exact isolation guarantee this phase's own prior plan (17-02) identified as necessary, contradicts the file's own documentation, and leaves one of TEAM-E2E-01's three intended checkpoints non-discriminating. Given this phase's explicit "scrutinize any assertion weaker than it appears" framing, this must be fixed, not left as the one un-patched instance of a bug already found and fixed three times over in sibling files.

**Fix:**
```typescript
const acceptCtx = await browser.newContext({ baseURL: resolvedBaseUrl, storageState: undefined });
```

## Warnings

### WR-01: Four of five specs create real `User`/`Link`/`QrCode`/`Domain` rows and never clean them up — one leaves behind a fixture account permanently promoted to `accountRole: "admin"`

**File:** `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts:185-188`
**File:** `apps/e2e/tests/authed/authz-domain-denial.spec.ts:178-181`
**File:** `apps/e2e/tests/authed/authz-admin-bypass.spec.ts:125-127`
**File:** `apps/e2e/tests/authed/team-invite-accept.spec.ts:122-129`
**Issue:** `apps/e2e/src/db.ts`'s `withResetDbLock` never truncates `User`/`Domain` (by design — truncating `Session` would invalidate every project's saved `storageState`), and none of these four specs' `finally` blocks delete the `User`/`Link`/`QrCode`/`Domain` rows they create — they only `close()` the extra browser context and `$disconnect()` Prisma:

```typescript
} finally {
  if (memberCtx) await memberCtx.close();
  await prisma.$disconnect();
}
```

Per-test cryptographically-unique emails/slugs/hostnames avoid immediate collisions, but the rows themselves persist for the remaining lifetime of the compose session, accumulating with every run. The worst instance: `team-role-domain-reassign.spec.ts` creates a throwaway zero-domain member via `createAllowlistedUser`, then — as its own test subject — promotes that member to `accountRole: "admin"` via the real `.role-select` UI (line ~173) and assigns it the baseline domain, and never revokes either afterward. This leaves a permanently-privileged, real admin-role `User` row (with a live `DomainMembership` on the baseline domain) sitting in the shared E2E database for the rest of the session — a least-privilege-fixture-discipline regression relative to `seedBaseline`'s own T-11-03 convention, and a contributor to the already-documented `analytics-global-rollup.spec.ts` "top-5 crowding" flake (`deferred-items.md` D-17-05-01 and 17-05-SUMMARY.md's own Issues Encountered both independently observed downstream flakiness consistent with accumulated fixture Link rows from this phase's specs).

Contrast with `team-member-removal.spec.ts`, whose own test subject IS deletion — that file leaves zero residue by design, confirmed in its own SUMMARY ("The seeded ADMIN_EMAIL/MEMBER_EMAIL fixture rows were confirmed untouched"). The other four specs have no equivalent self-cleanup step.

**Fix:** Add an explicit teardown in each `finally` block deleting the rows the spec itself created (member `User` row, fixture `Link`/`QrCode`, and — for `authz-admin-bypass.spec.ts` — the fresh `Domain` row), e.g.:
```typescript
} finally {
  if (memberCtx) await memberCtx.close();
  await prisma.qrCode.deleteMany({ where: { linkId: link.id } });
  await prisma.link.delete({ where: { id: link.id } });
  await prisma.user.delete({ where: { id: member.id } }); // cascades DomainMembership/Session
  await prisma.$disconnect();
}
```
At minimum, `team-role-domain-reassign.spec.ts` should demote/delete the member it promoted to admin, since that row's elevated privilege is the one with the clearest ongoing hygiene cost.

### WR-02: Cross-file `Link`/`QrCode`/`ClickEvent` truncate race is mitigated only by blanket retries, not by actual isolation — and this phase's own fixture accumulation (WR-01) widens the exposure window

**File:** `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts:42-50`
**File:** `apps/e2e/tests/authed/authz-domain-denial.spec.ts:44-51`
**Issue:** All five specs create `Link`/`QrCode` fixture rows via `createE2eLink`/`createE2eQrCode` entirely outside `withResetDbLock`'s advisory-locked critical section, while `db-isolation.spec.ts` (a different file, running concurrently under `fullyParallel: true`) truncates exactly those tables (`TRUNCATE "QrRemapHistory", "QrCode", "ClickEvent", "Link", "DomainMembership" RESTART IDENTITY CASCADE`) as part of its own reset cycle. Every spec's own comment acknowledges this ("straddles the same documented db-isolation.spec.ts cross-file truncate race window") and the sole mitigation is `test.describe.configure({ retries: 2 })` plus a `console.warn` on retry — i.e., accepting flakiness and retrying rather than closing the race. This is a pre-existing, already-accepted architectural tradeoff (documented in 17-RESEARCH.md's Sampling Rate section), not a new defect this phase introduced, but WR-01's leftover fixture rows (never deleted) mean the shared tables accumulate more standing data across a full suite run than if each spec cleaned up after itself, which — per this phase's own SUMMARY/deferred-items.md — is already producing observed knock-on flakiness in unrelated specs (`analytics-global-rollup.spec.ts`'s top-5 crowding, `team-role-domain-reassign.spec.ts` failing only when run directly after other team specs in the same window). Flagging here since the two issues (no cleanup + retry-only race mitigation) compound each other and neither is fixed by the other.
**Fix:** No production change needed. Closing WR-01 (explicit fixture teardown) would shrink, not eliminate, this exposure. A durable fix (scoping each spec's fixtures to a dedicated per-test `Domain` the shared truncate never touches, or excluding `Link`/`QrCode` created after a lock-held marker) is out of this phase's scope per its own SCOPE BOUNDARY rule — recommend folding into the same dedicated stabilization pass already recommended for D-17-05-01 (rate-limit bypass headers).

## Info

### IN-01: Retry/skip boilerplate duplicated near-verbatim across all five new spec files — the same debt 14/15/16-REVIEW.md's IN-01 already flagged three times, still unaddressed a fourth time

**File:** `apps/e2e/tests/authed/team-invite-accept.spec.ts:31-49`
**File:** `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts:50-69`
**File:** `apps/e2e/tests/authed/team-member-removal.spec.ts:58-76`
**File:** `apps/e2e/tests/authed/authz-domain-denial.spec.ts:51-70`
**File:** `apps/e2e/tests/authed/authz-admin-bypass.spec.ts:42-61`
**Issue:** The `test.describe.configure({ retries: 2 })` line, the `testInfo.project.name !== "chromium-admin"` skip block, and the `testInfo.retry > 0` `console.warn` attribution are copy-pasted near-verbatim across all five files (only the spec filename string and a few words of surrounding comment differ) — the identical maintainability concern raised in 14-REVIEW.md IN-01, 15-REVIEW.md IN-01, and 16-REVIEW.md IN-01, now recurring for a fourth phase in a row across five more files with zero remediation. The retry count, skip reason, and log format now need to change in at least 15 call sites across the whole `tests/authed/` directory if any one of them is ever revised.
**Fix:** Extract the previously-recommended shared helper (e.g. `adminOnlyRetryingDescribe(name, fn, { label, retries })` in a new `apps/e2e/src/testHelpers.ts`) — this is now a four-times-repeated recommendation and a good candidate for the same dedicated stabilization pass already proposed for D-17-05-01 and WR-02 above.

### IN-02: Redundant assertion in `authz-domain-denial.spec.ts`'s Analytics case

**File:** `apps/e2e/tests/authed/authz-domain-denial.spec.ts:174-177`
**Issue:**
```typescript
expect(anBody.topLinks).toEqual([]);
expect(anBody.topLinks.some((row) => row.id === link.id || row.slug === slug)).toBe(false);
```
The second assertion is dead code — `topLinks` was just asserted to be the empty array on the prior line, so `.some(...)` over an empty array is always `false` regardless of what it checks for. Harmless, but reads as if it were doing independent verification.
**Fix:** Drop the redundant `.some(...)` line, or replace the `toEqual([])` check with the narrower "does not contain this specific link" check if the intent was actually to allow a non-empty rollup as long as this specific click is excluded (matching the case for a less artificially-clean fixture domain).

---

_Reviewed: 2026-07-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
