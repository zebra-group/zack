---
phase: 17-team-management-domain-scoped-authz-e2e
fixed_at: 2026-07-25T10:32:24Z
review_path: .planning/phases/17-team-management-domain-scoped-authz-e2e/17-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 2
skipped: 1
status: partial
---

# Phase 17: Code Review Fix Report

**Fixed at:** 2026-07-25T10:32:24Z
**Source review:** .planning/phases/17-team-management-domain-scoped-authz-e2e/17-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (Critical + Warning — `fix_scope: critical_warning`, no `--all` flag; IN-01/IN-02 explicitly out of scope for this pass)
- Fixed: 2 (CR-01, WR-01)
- Skipped: 1 (WR-02 — no code fix required per the review's own Fix section)

## Fixed Issues

### CR-01: `team-invite-accept.spec.ts`'s "fresh, unauthenticated" acceptance context was missing `storageState: undefined`

**Files modified:** `apps/e2e/tests/authed/team-invite-accept.spec.ts`
**Commit:** `b285557`
**Applied fix:** Added `storageState: undefined` to the `acceptCtx = await browser.newContext({ baseURL: resolvedBaseUrl })` call (the one `browser.newContext()` call in the whole phase missing it), matching the exact pattern already established in `team-role-domain-reassign.spec.ts`, `team-member-removal.spec.ts`, and `authz-domain-denial.spec.ts`. Added an inline comment explaining why the override is required (this test only ever runs under `chromium-admin`, whose project config declares `use.storageState`). Confirmed this file makes no `.request` calls on `acceptCtx` (only `page.goto`), so no further "own-context `.request`" change was needed here — unlike 17-02's fix, which also had to redirect a POST through the new context's own `.request` object.

### WR-01: Four specs never cleaned up their own fixture rows

**Files modified:** `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts`, `apps/e2e/tests/authed/authz-domain-denial.spec.ts`, `apps/e2e/tests/authed/authz-admin-bypass.spec.ts`, `apps/e2e/tests/authed/team-invite-accept.spec.ts`
**Commit:** `210d435`
**Applied fix:** Read `apps/api/prisma/schema.prisma`'s relations first to right-size each file's teardown to its actual cascade shape rather than blindly copying the review's illustrative snippet:

- `team-role-domain-reassign.spec.ts`: hoisted `member`/`link` out of the `try` block (previously the return value of `createAllowlistedUser` wasn't even captured) and added, in `finally`, `prisma.link.delete` then `prisma.user.delete` for the member this spec's own test subject promotes to `accountRole: "admin"` with a live `DomainMembership` — the highest-hygiene-cost leaked fixture the review flagged.
- `authz-domain-denial.spec.ts`: same hoist-and-delete pattern for its zero-domain member + fixture Link (deleting the Link cascades its bound `QrCode` and the real `ClickEvent` this spec generates — no separate QR/ClickEvent delete needed per `schema.prisma`'s `onDelete: Cascade` chain). Also extracted `const fixtureLinkId = link.id` before the one usage inside a `.some()` closure — `let link: T | undefined` loses narrowing inside closures, so this was required for `tsc --noEmit` to pass, not a style preference.
- `authz-admin-bypass.spec.ts`: hoisted `bypassDomain` and delete it alone in `finally` — deleting the Domain cascades its Link, which cascades its QrCode, so one call tears down the whole fixture tree (no new User is created in this spec; the existing seeded admin is reused and never touched).
- `team-invite-accept.spec.ts`: added `prisma.user.delete` for the invitee right after the Step 5 `emailVerified` assertion, inside the same `try`/`finally` that already disconnects Prisma there — this spec creates no fixture Link/QR, only the invitee User (whose real Session created during acceptance cascades on delete).

None of the four touch the seeded `ADMIN_EMAIL`/`MEMBER_EMAIL` baseline fixtures or the baseline `Domain` — confirmed by re-reading each diff against `apps/e2e/src/db.ts`'s `seedBaseline`/`withResetDbLock` before editing.

`team-member-removal.spec.ts` was correctly left untouched — its own test subject IS deletion, so it already leaves zero residue by design (confirmed in the review and in its own SUMMARY).

## Skipped Issues

### WR-02: Cross-file Link/QrCode/ClickEvent truncate race, mitigated only by blanket retries

**File:** `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts:42-50`, `apps/e2e/tests/authed/authz-domain-denial.spec.ts:44-51`
**Reason:** The review's own **Fix:** section states explicitly: "No production change needed... A durable fix... is out of this phase's scope per its own SCOPE BOUNDARY rule — recommend folding into the same dedicated stabilization pass already recommended for D-17-05-01." This is a pre-existing, already-accepted architectural tradeoff (documented in 17-RESEARCH.md's Sampling Rate section), not a new defect. The WR-01 fix just applied (explicit fixture teardown) shrinks this exposure window — fewer standing `Link`/`QrCode` rows sitting in the shared tables for `db-isolation.spec.ts`'s concurrent truncates to interact with — but does not eliminate the race, exactly as the review frames it. No `fetchWithFixtureRaceRetry` retrofit or other code change was applied, since the review's authoritative recommendation is to defer this to a future dedicated stabilization pass rather than patch it now.
**Original issue:** All five specs create `Link`/`QrCode` fixture rows outside `withResetDbLock`'s advisory-locked critical section while `db-isolation.spec.ts` truncates those same tables concurrently under `fullyParallel: true`; the sole mitigation is `test.describe.configure({ retries: 2 })` plus a `console.warn` on retry, and WR-01's (pre-fix) leftover fixture rows widened the exposure.

## Verification

- **Tier 1 (mandatory):** Re-read every modified section in all four/five files after editing — each fix's text is present, comments read correctly, and no surrounding code was disturbed.
- **Tier 2:** `pnpm --filter @kurzly/e2e exec tsc --noEmit` — clean (exit 0) after both commits. One intermediate failure was caught and fixed before committing: `authz-domain-denial.spec.ts`'s new `let link: T | undefined` lost type-narrowing inside a pre-existing `.some()` closure at the Analytics assertion (`row.id === link.id`); resolved by extracting `const fixtureLinkId = link.id` immediately before that closure, then re-ran `tsc --noEmit` clean. Only a pre-existing, unrelated `Unsupported engine` pnpm warning (local Node v22 vs. the project's pinned 24.x) appears in the output — present before this change too.
- **Live Playwright re-verification against the Docker compose stack was NOT performed** by this fixer pass — explicitly skipped due to time, as permitted by the task instructions. The orchestrator will perform a final live re-verification pass regardless, since this is the v1.1 milestone's final phase.
- All changes are test-file-only (no `apps/api`/`apps/web` production code touched). The CR-01 fix is a one-line config addition matching an already-proven pattern used elsewhere in the same phase. The WR-01 fixes are additive teardown code in `finally` blocks, relying entirely on `schema.prisma`'s existing, already-shipped cascade rules (`onDelete: Cascade`) — no new cascade behavior was introduced or assumed.

---

_Fixed: 2026-07-25T10:32:24Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
