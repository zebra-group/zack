---
phase: 17-team-management-domain-scoped-authz-e2e
verified: 2026-07-25T12:00:00Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 17: Team Management & Domain-Scoped Authorization E2E Verification Report

**Phase Goal:** Prove the invite-only team lifecycle end-to-end (invite → magic-link delivery → acceptance → roster update), that a role/domain reassignment takes real effect in the affected member's own re-navigated session, that removing a member immediately revokes their active session, and that domain-scoped authorization is enforced server-side through the real UI for one representative case per resource type (Link, QR, Analytics), plus one account-admin domain-bypass case. This is the FINAL phase of the v1.1 E2E Test Coverage milestone.
**Verified:** 2026-07-25
**Status:** passed
**Re-verification:** No — initial verification (post-review-fix, incorporating the orchestrator's own documented live re-verification pass this session)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CR-01's fix (`storageState: undefined`) is genuinely present in `team-invite-accept.spec.ts` | ✓ VERIFIED | Read the file directly: line 105, `const acceptCtx = await browser.newContext({ baseURL: resolvedBaseUrl, storageState: undefined });`, with an inline comment explaining why it's required. Commit `b285557` present in `git log` for this file. |
| 2 | WR-01's teardown fixes are genuinely present in the 4 affected files | ✓ VERIFIED | Read all 4 files directly. `team-invite-accept.spec.ts:142` `prisma.user.delete`. `team-role-domain-reassign.spec.ts:197-198` `prisma.link.delete` + `prisma.user.delete` (the promoted-to-admin member). `authz-domain-denial.spec.ts:191-192` `prisma.link.delete` + `prisma.user.delete`. `authz-admin-bypass.spec.ts:134` `prisma.domain.delete` (cascades Link/QrCode). All in `finally` blocks. Commit `210d435` present. |
| 3 | TEAM-E2E-03's revocation assertion is genuinely immediate (no polling/wait) | ✓ VERIFIED | `team-member-removal.spec.ts:151-153`: exactly one `memberPage.request.get("/api/auth/get-session")` call immediately after the awaited `204` DELETE response resolves, asserted `toBeNull()` — no loop, no `waitForTimeout`, no retry-until-condition. Confirms the code-verified schema-cascade claim from 17-RESEARCH.md is actually exercised, not merely asserted in prose. |
| 4 | AUTHZ-E2E-01 correctly differentiates 404 (Link/QR) from empty-200-rollup (Analytics) | ✓ VERIFIED | `authz-domain-denial.spec.ts` CASE 1 (lines 142-144): `.not-found-card` visible on `/links/:id`. CASE 2 (lines 152-155): `page.request.get('/api/qr-codes/:id')` and `/api/links/:id` both asserted `.status() === 404`. CASE 3 (lines 160-180): `/analytics` renders zero-data UI branch AND `page.request.get('/api/analytics')` asserted `.status() === 200` (explicitly NOT 404) with `clicks30Days === 0` and `topLinks === []`, cross-checked against a real seeded 302 click the member cannot see. Shapes are genuinely distinct in the code, not just in the plan's prose. |
| 5 | AUTHZ-E2E-02 asserts the zero-DomainMembership precondition BEFORE the bypass claim | ✓ VERIFIED | `authz-admin-bypass.spec.ts:79-80`: `prisma.domainMembership.count(...)` asserted `.toBe(0)` BEFORE the fresh domain/Link/QR fixture is even created (lines 89+) and before the UI/API bypass proof (lines 115+). Ordering in the source file matches the plan's required sequencing. |
| 6 | No test targets/mutates the seeded baseline admin/member fixtures (only newly-created members) | ✓ VERIFIED | Grepped all 5 files for `ADMIN_EMAIL`/`MEMBER_EMAIL` usage: `authz-admin-bypass.spec.ts` only *reads* `ADMIN_EMAIL` (`findUniqueOrThrow` + a `count` read) — never writes to it, never assigns it a `DomainMembership`, never changes its role. The other 4 files exclusively use `createAllowlistedUser`/per-test crypto-unique emails (`team-invite-<hex>@...`, `reassign-<hex>@...`, `removal-<hex>@...`, `authz-deny-<hex>@...`) for the member(s) they create, modify, promote, or delete. `team-role-domain-reassign.spec.ts` does promote its own newly-created member to `accountRole: "admin"` (Part B) — this is the plan's intended test subject, not the seeded baseline admin, and the spec deletes that promoted member in its `finally` block. |

**Score:** 6/6 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/e2e/tests/authed/team-invite-accept.spec.ts` | TEAM-E2E-01 real-UI invite → Mailpit → accept → status flip | ✓ VERIFIED | Exists, substantive (147 lines, real assertions against `.status-badge`, real `POST /api/team/invite` 201 wait, real Prisma cross-check), wired into `chromium-admin` project via `test.beforeEach` skip guard. |
| `apps/e2e/tests/authed/team-role-domain-reassign.spec.ts` | TEAM-E2E-02 domain+role reassignment reaches member's own session | ✓ VERIFIED | Exists, substantive (202 lines), two real browser contexts, real `PUT`/`PATCH` awaited responses, real `/links/:id` 404→detail transition. |
| `apps/e2e/tests/authed/team-member-removal.spec.ts` | TEAM-E2E-03 immediate revocation | ✓ VERIFIED | Exists, substantive (172 lines), threefold proof (API null, UI redirect, DB cascade), no polling. |
| `apps/e2e/tests/authed/authz-domain-denial.spec.ts` | AUTHZ-E2E-01 zero-domain denial, 3 resource types | ✓ VERIFIED | Exists, substantive (196 lines), correctly differentiated 404 vs. 200-empty-rollup shapes. |
| `apps/e2e/tests/authed/authz-admin-bypass.spec.ts` | AUTHZ-E2E-02 admin bypass | ✓ VERIFIED | Exists, substantive (138 lines), explicit precondition + fresh second-domain resource + UI/API 200 proof. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `team-invite-accept.spec.ts` | `apps/e2e/src/mailpit.ts`'s `findMagicLinkUrl` | invite email retrieval | WIRED | Imported and called with the per-test invitee email; used to drive the acceptance navigation. |
| All 4 fixture-creating specs | `apps/e2e/src/users.ts`'s `createAllowlistedUser` | zero-domain/active member fixture | WIRED | `createAllowlistedUser` exists (`apps/e2e/src/users.ts:46`), imported and invoked with a per-test unique email in each spec that needs one. |
| `team-role-domain-reassign.spec.ts`/`authz-domain-denial.spec.ts`/`authz-admin-bypass.spec.ts` | `apps/e2e/src/links.ts`'s `createE2eLink` (with `domainHostname` option) | fixture Link on baseline/second domain | WIRED | Confirmed `createE2eLink` accepts `opts.domainHostname` (`apps/e2e/src/links.ts:74,101`); `authz-admin-bypass.spec.ts` uses it to place the Link on the fresh non-baseline domain. |
| All 5 specs | `apps/e2e/playwright.config.ts`'s `chromium-admin` project | test scoping | WIRED | Each spec's `test.beforeEach` calls `test.skip(testInfo.project.name !== "chromium-admin", ...)` — confirmed present in every file. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TEAM-E2E-01 | 17-01 | Invite → acceptance → roster status flip | ✓ SATISFIED | `team-invite-accept.spec.ts`, live-verified per orchestrator's documented compose re-run; REQUIREMENTS.md marks `[x]`/Complete. |
| TEAM-E2E-02 | 17-02 | Role/domain reassignment reaches member's own session | ✓ SATISFIED | `team-role-domain-reassign.spec.ts`. |
| TEAM-E2E-03 | 17-03 | Immediate session revocation on removal | ✓ SATISFIED | `team-member-removal.spec.ts`, no-polling assertion confirmed by direct source read. |
| AUTHZ-E2E-01 | 17-04 | Representative domain-denial (Link/QR/Analytics) | ✓ SATISFIED | `authz-domain-denial.spec.ts`. |
| AUTHZ-E2E-02 | 17-05 | Account-admin bypass | ✓ SATISFIED | `authz-admin-bypass.spec.ts`. |

No orphaned requirements found — REQUIREMENTS.md's traceability table maps all 5 IDs to Phase 17 / Complete, matching the 5 plans' `requirements:` frontmatter exactly.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 5 spec files (grep exit code 1, zero matches) | — | None |

Carried-forward, non-blocking items from 17-REVIEW.md (explicitly out of this phase's fix scope, already triaged by the review/fix cycle):
- **WR-02** (Info→Warning, skipped by design): cross-file `Link`/`QrCode`/`ClickEvent` truncate race vs. `db-isolation.spec.ts`, mitigated only by `retries: 2`. Pre-existing, cross-cutting, explicitly deferred per the review's own "no production change needed" framing — not a Phase 17 regression.
- **IN-01**: retry/skip boilerplate duplicated across all 5 files (and 3 prior phases) — cosmetic maintainability debt, not a functional gap.
- **IN-02**: one redundant (dead-code but harmless) assertion in `authz-domain-denial.spec.ts` line 180 (`.some(...)` over an array already asserted empty on the prior line). Confirmed present, confirmed harmless — does not weaken the actual proof (the `toEqual([])` on the prior line is the operative assertion).
- **D-17-05-01** (`deferred-items.md`): full-`tests/authed/`-directory rate-limit-bucket exhaustion — documented, isolated, confirmed unrelated to any Phase 17 spec's own correctness (each of the 5 new specs passed cleanly standalone and in every restart-segmented chunk tested).

None of these rise to blocker severity; all were already correctly triaged as non-blocking by the phase's own review cycle.

### Human Verification Required

None. All must-haves are either directly source-verifiable (code reads) or already covered by the orchestrator's documented live Playwright re-verification against the rebuilt compose stack this session (all 5 new specs passed individually on fresh boots; full `tests/authed/` 15-file suite passed in restart-segmented chunks with only the pre-documented, unrelated rate-limit ceiling causing 2 transient failures that were independently confirmed passing standalone).

### Milestone-Wide Sanity Check (v1.1 E2E Test Coverage close-out)

- `.planning/ROADMAP.md`: all 7 phases (11-17) marked `[x]` complete with dates; the summary table shows `17. Team Mgmt & Domain-Scoped Authz E2E | v1.1 | 5/5 | Complete | 2026-07-25`.
- `.planning/REQUIREMENTS.md`: TEAM-E2E-01/02/03 and AUTHZ-E2E-01/02 all `[x]` and listed `Complete` in the traceability table; a repository-wide `grep -c "Pending"` over REQUIREMENTS.md returns `0` — no requirement is still marked pending.
- No production code (`apps/api`, `apps/web`) was touched by any of the 5 plans or the review-fix pass — confirmed by each plan's own `files_modified` frontmatter and the review-fix report's explicit statement.

### Gaps Summary

No gaps found. All 6 goal-backward truths, all 5 required artifacts, and all 5 requirement IDs are verified against the actual current source of the 5 spec files (not SUMMARY narrative alone). The two issues the task specifically asked to scrutinize hardest — CR-01's `storageState: undefined` fix and WR-01's teardown fixes — were independently re-confirmed present in the current file contents (not just trusted from 17-REVIEW-FIX.md's claims). TEAM-E2E-03's "immediate" revocation claim was independently confirmed to be a single, unpolled assertion rather than a masked eventual-consistency check. AUTHZ-E2E-01/02's differentiated denial shapes and precondition-before-claim ordering were both confirmed by direct line-level source reading. The phase's own review cycle (17-REVIEW.md → 17-REVIEW-FIX.md) already correctly triaged and closed the Critical and the higher-value Warning; the remaining Warning (WR-02) and both Info items are legitimately deferred, non-blocking debt, not silently swept gaps.

Ready to proceed with the v1.1 milestone close-out.

---

_Verified: 2026-07-25T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
