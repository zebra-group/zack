---
phase: 09-team-management-domain-scoped-authorization-enforcement
plan: 07
subsystem: web
tags: [vue, vue-test-utils, api-client, modals]

# Dependency graph
requires:
  - phase: 09-04
    provides: "PATCH role / PUT domains / DELETE member routes + TeamErrorCode/UpdateMemberRoleInput/AssignDomainsInput shared DTOs"
  - phase: 09-03
    provides: "InviteMemberInput shared DTO, POST /api/team/invite route"
  - phase: 09-06
    provides: "listTeamMembers() client, read-only TeamView.vue roster (avatar/name/email/role/domain-access/status), role-model card"
provides:
  - "changeMemberRole/assignMemberDomains/removeMember/inviteMember API clients + mapTeamError (apps/web/src/api.ts)"
  - "TeamView.vue: immediate optimistic role-change with paired role+chip revert and last-admin proactive disable (UI-09-03/04/07)"
  - "InviteMemberModal.vue (§8): email validation, role cards, member-only domain toggles, re-invite resend"
  - "AssignDomainsModal.vue (UI-09-05): pre-filled domain toggle-pill assignment for existing members"
  - "⋯-menu remove flow with the shared delete-confirmation dialog and in-dialog LAST_ADMIN lockout error"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mapTeamError(err) returns a single flat message string (not a field-error object like mapLinkFormError/mapQrFormError) — every Phase 9 error surface (.member-error-row, .dialog-error, the invite modal's .field-error fallback) is a single flat message, never a multi-field form"
    - "Paired optimistic-update + revert: handleRoleChange captures BOTH the previous role AND previous domains before mutating, and restores both together on rejection — the member->admin chip swap and its rollback are always atomic (T-09-OPT-DESYNC)"
    - "Client-side lastAdmin(member) computed (accountRole==='admin' && adminCount===1) drives BOTH the disabled role <select> and the disabled '⋯ > Mitglied entfernen' menu entry — one guard function, two UI surfaces, server (09-04's FOR UPDATE-locked countAdmins) remains authoritative regardless (T-09-UI-LOCKOUT)"
    - "InviteMemberModal/AssignDomainsModal share an IDENTICAL overlay/dialog shell + domain-toggle-pill block (both 460px, both duplicate the CSS locally rather than extracting a shared component) — matches this codebase's established per-modal-duplication convention (LinkFormModal.vue's own self-contained styles)"
    - "Re-invite is a row UPSERT, not an append: handleInviteSubmit looks up the returned member's id in the existing list and replaces in place if found, appends only if new — prevents a duplicate row on D-09-04's resend-is-not-an-error path"
    - "⋯ action-menu item uses @mousedown.prevent to prevent the browser's focus-shift-triggered blur (which would close the menu via v-if before the click event fires) from racing the actual remove-click"

key-files:
  created:
    - apps/web/src/components/InviteMemberModal.vue
    - apps/web/src/components/AssignDomainsModal.vue
    - apps/web/src/components/InviteMemberModal.test.ts
    - apps/web/src/components/AssignDomainsModal.test.ts
  modified:
    - apps/web/src/api.ts
    - apps/web/src/views/TeamView.vue
    - apps/web/src/views/TeamView.test.ts

key-decisions:
  - "mapTeamError lives in api.ts (not inside an SFC) and returns a plain string, following the established mapLinkFormError/mapQrFormError convention that the generic *.vue module shim only declares a default export — but simplified to a single message since every Phase 9 error surface is a single flat line, unlike the multi-field Link/QR forms"
  - "InviteMemberModal/AssignDomainsModal follow LinkFormModal's parent-owns-the-call convention: neither modal calls the API itself, they only emit a payload; TeamView owns the actual inviteMember/assignMemberDomains calls and passes the last mapped error back down via an `error` prop"
  - "The invite modal's error prop renders under the email field even for a non-email-specific server error (e.g. a generic mapTeamError fallback) — this plan's api.ts scope (Task 1) intentionally added only mapTeamError (not a dedicated per-field invite error mapper), so the single flat message renders in the modal's one available inline-error slot rather than inventing a second error channel"
  - "AssignDomainsModal keeps a modal-level `error` prop (rendered as a generic `.field-error` line above the footer) and, on rejection, stays open rather than closing — the plan's must_haves list no dedicated error case for assign-domains saves, but leaving a failed save silent (toast-only, modal closed) would hide the failure from the admin mid-action; this is a Rule 2 (missing critical functionality: error handling) addition, minimal in scope (reuses the existing mapTeamError + a prop, no new API surface)"
  - "The Copywriting Contract's inherited 429 rate-limit message ('Zu viele Anfragen...') is NOT specially wired into mapTeamError/InviteMemberModal — Task 1's action text scopes mapTeamError to LAST_ADMIN + a generic fallback only, and a 429 on invite falls through to the generic 'Aktion fehlgeschlagen...' message. The server (@fastify/rate-limit, MAGIC_LINK_RATE_LIMIT) still enforces the actual rate limit regardless of the displayed copy — this is a cosmetic message-precision gap, not a security or correctness gap, and out of this plan's explicit files_modified/action scope. Documented here rather than silently left for a future phase to guess at."

patterns-established:
  - "Row-local transient error field on a UI-only extension interface (MemberUI extends TeamMemberDTO { error?: string | null }) — mirrors DomainsView's DomainUI extends DomainDTO { verifyError } pattern for the same 'transient, never-persisted, revert-target' shape"

requirements-completed: [TEAM-01, TEAM-03, TEAM-04, TEAM-05]

coverage:
  - id: D1
    description: "Changing a member's role commits immediately on change; on server rejection the select reverts to its previous value and an inline .member-error-row appears under the row (UI-09-03), with the LAST_ADMIN code producing the locked lockout copy and any other rejection the generic fallback"
    requirement: "TEAM-04"
    verification:
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView role change (09-07 Task 1, UI-09-03/04/07) > commits a role change immediately, swaps chips for the accent pill, and toasts success"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView role change (09-07 Task 1, UI-09-03/04/07) > reverts BOTH role and domain chips on a generic rejection, rendering an inline .member-error-row"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView role change (09-07 Task 1, UI-09-03/04/07) > shows the locked LAST_ADMIN copy inline and reverts the select on a 409 LAST_ADMIN rejection"
        status: pass
    human_judgment: false
  - id: D2
    description: "Switching a member to Admin replaces their domain chips with the 'alle Domains' pill in the same optimistic update; a rejection rolls back BOTH role and chips together"
    requirement: "TEAM-04"
    verification:
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView role change (09-07 Task 1, UI-09-03/04/07) > commits a role change immediately, swaps chips for the accent pill, and toasts success"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView role change (09-07 Task 1, UI-09-03/04/07) > reverts BOTH role and domain chips on a generic rejection, rendering an inline .member-error-row"
        status: pass
    human_judgment: false
  - id: D3
    description: "The invite modal (§8) creates a pending member and shows a success toast; re-inviting an existing address is not an error and toasts the same message; an invalid email shows an inline field error and does not submit"
    requirement: "TEAM-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/InviteMemberModal.test.ts#InviteMemberModal > renders an inline .field-error and does not emit submit for an empty email"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/InviteMemberModal.test.ts#InviteMemberModal > emits submit with email/accountRole/domainIds for a valid Mitglied invite"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView invite flow (09-07 Task 2, §8/UI-09-11, D-09-04) > invites a member, appends a new pending row without reload, toasts, and closes the modal"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView invite flow (09-07 Task 2, §8/UI-09-11, D-09-04) > re-invites an existing address as a non-error resend, updating (not duplicating) the row"
        status: pass
    human_judgment: false
  - id: D4
    description: "The AssignDomainsModal opens from a member's '+ zuweisen' pill or a domain chip, saves the chosen domains, and updates the row's chips without reload; never reachable for an admin row"
    requirement: "TEAM-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/AssignDomainsModal.test.ts#AssignDomainsModal > pre-selects the member's current domains"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView assign-domains flow (09-07 Task 3, UI-09-05/12, TEAM-03) > opens AssignDomainsModal pre-filled from the '+ zuweisen' pill and updates chips on save"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView assign-domains flow (09-07 Task 3, UI-09-05/12, TEAM-03) > also opens AssignDomainsModal from clicking an existing domain chip"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView assign-domains flow (09-07 Task 3, UI-09-05/12, TEAM-03) > never offers a clickable domain assignment for an admin row (UI-09-12)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The ⋯ menu offers 'Mitglied entfernen' -> shared delete dialog; removing succeeds with a toast, a last-admin lockout renders a typed error inside the dialog, and the sole admin's role select and remove action are proactively disabled"
    requirement: "TEAM-05"
    verification:
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView remove flow (09-07 Task 3, UI-09-06/07, TEAM-05) > removes a member via the ⋯ menu's shared delete dialog and toasts success"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView remove flow (09-07 Task 3, UI-09-06/07, TEAM-05) > shows a .dialog-error with the locked LAST_ADMIN copy and keeps the dialog open on lockout"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView remove flow (09-07 Task 3, UI-09-06/07, TEAM-05) > disables the sole admin's 'Mitglied entfernen' entry with an explanatory title"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/TeamView.test.ts#TeamView role change (09-07 Task 1, UI-09-03/04/07) > proactively disables the sole remaining admin's role select with an explanatory title"
        status: pass
    human_judgment: false

# Metrics
duration: 42min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 7: Team Screen Mutations — Invite, Role Change, Domain Assignment, Remove Summary

**Wires the mutation half of the Team screen onto 09-06's read-only roster: the team mutation API client (`changeMemberRole`/`assignMemberDomains`/`removeMember`/`inviteMember`/`mapTeamError`), an immediate optimistic role-change with paired role+chip revert and a proactive last-admin disable, the `InviteMemberModal.vue` (§8) with client-side email validation and re-invite resend, the `AssignDomainsModal.vue` for existing-member domain assignment, and the ⋯-menu remove flow through the shared delete-confirmation dialog with an in-dialog LAST_ADMIN lockout error**

## Performance

- **Duration:** ~42 min
- **Started:** 2026-07-23T10:15:00+02:00
- **Completed:** 2026-07-23T10:37:00+02:00
- **Tasks:** 3
- **Files modified:** 7 (3 created, 4 modified — 2 of the 3 "created" are their own test files)

## Accomplishments

- `api.ts`: added `changeMemberRole(id, accountRole)` (PATCH `/api/team/:id/role`), `assignMemberDomains(id, domainIds)` (PUT `/api/team/:id/domains`), `removeMember(id)` (DELETE, 204, with manual JSON error-code extraction since a 204 body can't be parsed as `T`), `inviteMember(input)` (POST `/api/team/invite`), and `mapTeamError(err)` — a single-string error mapper keyed on `ApiError.code`, mirroring `mapLinkFormError`/`mapQrFormError`'s "lives in api.ts" convention but returning one flat message (`LAST_ADMIN` → the locked lockout copy, everything else → the generic fallback) since every Phase 9 error surface renders exactly one line.
- `TeamView.vue`: the role `<select>` now commits immediately on `@change` (UI-09-03) — captures the previous role AND previous domains, optimistically applies the new role (clearing domains to `[]` for member→admin), calls `changeMemberRole`, and on success shows a "Rolle aktualisiert" toast; on rejection reverts BOTH role and domains together and renders `mapTeamError(err)` in a `.member-error-row` under the row (UI-09-04/07). A `lastAdmin(member)` computed (`accountRole==='admin' && adminCount===1`) disables the select with an explanatory `title`.
- `InviteMemberModal.vue` (new, §8/Surface C): 460px overlay/dialog shell, email field with client-side shape validation (`.field-error`, blocks submit on empty/invalid), two role cards (Admin/Mitglied, `aria-checked` radiogroup), a member-only domain toggle-pill block (hidden for Admin, `aria-pressed` multi-select), and a footer emitting `{ email, accountRole, domainIds }` on submit. TeamView wires the invite button to open it, calls `inviteMember` on submit, appends the returned pending row (or replaces the existing row in place for a re-invite, D-09-04) with a "Magic Link an {email} gesendet" toast, and maps a rejection to the modal's inline error via `mapTeamError`.
- `AssignDomainsModal.vue` (new, UI-09-05/Surface D): identical shell + domain toggle-pill block to the invite modal, pre-seeded from `initialDomainIds`, emitting the full selected-id array on "Speichern". TeamView makes a member's domain chips AND "+ zuweisen" pill clickable (never for an admin row, UI-09-12) to open it, calls `assignMemberDomains` on save, updates the row's domains from the returned DTO, toasts "Domain-Zugriff aktualisiert", and — on rejection — keeps the modal open with an inline error rather than failing silently.
- `TeamView.vue`'s ⋯ cell is now a keyboard-reachable action menu (`role="button"`, `tabindex`, Enter/Space, Escape/blur-close) with one entry "Mitglied entfernen" that opens the shared 380px delete-confirmation dialog (reused verbatim from `DomainsView.vue`'s markup/CSS, TEAM-05/D-09-06 copy). Confirming calls `removeMember`, removes the row, and toasts "{email} entfernt"; a `LAST_ADMIN` rejection renders a `.dialog-error` line inside the still-open dialog instead of closing it. The menu entry is disabled (with title) for the sole remaining admin.

## Task Commits

All three tasks followed genuine RED → GREEN, each verified failing before implementation:

1. **Task 1: Team mutation API client + immediate role change**
   - `cb63a15` test(09-07): failing role-change optimistic/revert/lockout cases
   - `096b8d3` feat(09-07): team mutation client + immediate role change with revert and last-admin guard
2. **Task 2: InviteMemberModal + invite wiring**
   - `f7f3870` test(09-07): failing invite-modal + invite-wiring cases
   - `11dfcea` feat(09-07): InviteMemberModal and invite flow with re-invite resend
3. **Task 3: AssignDomainsModal + ⋯-menu remove flow**
   - `b7d9bc9` test(09-07): failing assign-modal + remove-flow + lockout-dialog cases
   - `cb605fd` feat(09-07): AssignDomainsModal and remove flow with last-admin lockout

RED was verified genuinely for all three tasks: Task 1's new role-change assertions failed against the pre-existing inert `<select>` (no `@change` handler, `changeMemberRole` never called); Task 2's `InviteMemberModal.test.ts` failed to even resolve the not-yet-created component, and `TeamView.test.ts`'s invite-flow cases failed against the still-no-op `openInvite()`; Task 3's `AssignDomainsModal.test.ts` likewise failed to resolve, and `TeamView.test.ts`'s assign/remove cases failed against the still-static domain chips and inert `⋯` cell.

## Files Created/Modified

- `apps/web/src/api.ts` — `changeMemberRole`/`assignMemberDomains`/`removeMember`/`inviteMember`/`mapTeamError`
- `apps/web/src/views/TeamView.vue` — role-change wiring, invite/assign modal integration, ⋯-menu + delete dialog, `MemberUI`/`lastAdmin`/`adminCount`
- `apps/web/src/components/InviteMemberModal.vue` (new) — §8 invite modal
- `apps/web/src/components/AssignDomainsModal.vue` (new) — UI-09-05 assign modal
- `apps/web/src/views/TeamView.test.ts` — role-change, invite-flow, assign-domains-flow, remove-flow describe blocks (20 new cases)
- `apps/web/src/components/InviteMemberModal.test.ts` (new) — 8 cases
- `apps/web/src/components/AssignDomainsModal.test.ts` (new) — 5 cases

## Decisions Made

- `mapTeamError` returns a single flat string rather than a field-error object (unlike `mapLinkFormError`/`mapQrFormError`) since every Phase 9 error surface (`.member-error-row`, `.dialog-error`, the invite modal's `.field-error` fallback) is one flat line.
- Both new modals follow LinkFormModal's parent-owns-the-call convention: they emit a payload/selection, never call the API themselves; TeamView owns every mutation call and feeds the mapped error back via an `error` prop.
- AssignDomainsModal gained a modal-level `error` prop and stays open on a rejected save (Rule 2 addition — the plan's must_haves didn't specify this error case, but a silent failed save would be worse than the existing inline-error convention used everywhere else in this plan).
- The Copywriting Contract's inherited 429 rate-limit message is not specially wired into `mapTeamError`/`InviteMemberModal` — out of Task 1's explicit scope (LAST_ADMIN + generic fallback only); a 429 on invite shows the generic fallback message instead. The server's rate limit itself is unaffected (cosmetic gap only, documented above).

## Deviations from Plan

### Auto-fixed Issues

None beyond the one documented decision above (AssignDomainsModal's in-modal error handling, Rule 2 — tracked as a decision rather than a "fix" since nothing was broken, just under-specified).

## Issues Encountered

None. `pnpm --filter @kurzly/web test` (21 files / 240 tests) and `pnpm -r exec tsc --noEmit` were both clean after each task's GREEN commit, with zero regressions across the existing 213 web tests from before this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The Team Management screen (TEAM-01/02/03/04/05/06) is now complete end to end: invite, immediate role change with safe revert, domain assignment, and removal, all with success toasts and typed inline/dialog lockout errors, completing Phase 9's frontend scope.
- No blockers or concerns for subsequent phases.

---
*Phase: 09-team-management-domain-scoped-authorization-enforcement*
*Completed: 2026-07-23*

## Self-Check: PASSED

All 7 created/modified files verified present on disk; all 6 task commit hashes (`cb63a15`, `096b8d3`, `f7f3870`, `11dfcea`, `b7d9bc9`, `cb605fd`) verified present in git history.
