---
phase: 260724-d6y-add-delete-path-for-qr-codes
plan: 01
subsystem: api
tags: [fastify, prisma, vue, qr-codes, delete]

requires:
  - phase: 07-qr-codes-static-dynamic-qr-studio
    provides: QrCode model, resolveOwnedQrCode IDOR guard, QrStudioPanel.vue, api.ts QR client
provides:
  - "DELETE /api/qr-codes/:id backend route (WR-07)"
  - "deleteQrCode(id) frontend API client function"
  - "QR Studio delete button + confirm dialog + deleted emit"
affects: [qr-codes, qr-studio]

tech-stack:
  added: []
  patterns:
    - "DELETE /api/qr-codes/:id mirrors DELETE /api/links/:id exactly (resolveOwnedQrCode IDOR guard, 204/404/401)"
    - "QR delete confirm dialog reuses LinkDetailView's Link-delete dialog copy verbatim with Link -> QR-Code"

key-files:
  created: []
  modified:
    - apps/api/src/routes/qrCodes.ts
    - apps/api/test/qrCodes.integration.test.ts
    - apps/web/src/api.ts
    - apps/web/src/components/QrStudioPanel.vue
    - apps/web/src/components/QrStudioPanel.test.ts
    - apps/web/src/views/QrCodesView.vue
    - apps/web/src/views/QrCodesView.test.ts

key-decisions:
  - "DELETE route reuses resolveOwnedQrCode verbatim — no new authorization check introduced (T-WR07-01)"
  - "No manual QrRemapHistory cleanup — relies on the existing onDelete: Cascade FK (schema.prisma), proven by an integration test"
  - "All delete-dialog/toast copy derived from LinkDetailView.vue's Link-delete originals via a single Link -> QR-Code substitution, no invented wording"

patterns-established:
  - "Delete-flow test convention for future entity types: confirm-dialog-open / confirm-success-emits-deleted+toast / cancel-noop / failure-toasts-keeps-item"

requirements-completed: [WR-07]

coverage:
  - id: D1
    description: "Authenticated user can delete an owned QR code from QR Studio; the card disappears from the list"
    requirement: "WR-07"
    verification:
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#confirming calls deleteQrCode with the qr id, emits deleted + toast, and closes the dialog"
        status: pass
      - kind: unit
        ref: "apps/web/src/views/QrCodesView.test.ts#removes the card from the list and reselects the first remaining card when the studio panel emits deleted"
        status: pass
    human_judgment: false
  - id: D2
    description: "DELETE /api/qr-codes/:id is IDOR-guarded (404 for both not-found and forbidden) and 401s with no session"
    requirement: "WR-07"
    verification:
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#DELETE /api/qr-codes/:id (route layer, IDOR guard — WR-07)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Deleting a dynamic QR cascades its QrRemapHistory rows (no orphaned audit rows)"
    requirement: "WR-07"
    verification:
      - kind: integration
        ref: "apps/api/test/qrCodes.integration.test.ts#cascade: deleting a dynamic QR also removes its QrRemapHistory rows (FK onDelete: Cascade)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A failed delete shows the failure toast and keeps the card"
    requirement: "WR-07"
    verification:
      - kind: unit
        ref: "apps/web/src/components/QrStudioPanel.test.ts#a failed delete toasts the failure message, keeps the card (no deleted emit)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-24
status: complete
---

# Quick Task 260724-d6y: Add delete path for QR codes Summary

**DELETE /api/qr-codes/:id (IDOR-guarded, cascades QrRemapHistory) plus a QR Studio delete button + confirm dialog reusing Link-delete's locked copy**

## Performance

- **Duration:** ~10 min
- **Tasks:** 2 completed
- **Files modified:** 7

## Accomplishments

- Backend `DELETE /api/qr-codes/:id` route added to `routes/qrCodes.ts`, mirroring `DELETE /api/links/:id` exactly: `resolveOwnedQrCode` IDOR guard, 204 on success, 404 for not-found/forbidden (indistinguishable), 401 with no session
- Cascade proven by a dedicated integration test: remapping a dynamic QR once, then deleting it, leaves zero `QrRemapHistory` rows — no manual cleanup code was added, the existing `onDelete: Cascade` FK does the work
- Frontend `deleteQrCode(id)` client function added to `api.ts`, mirroring `deleteLink`
- `QrStudioPanel.vue` gained a delete button (studio header) + confirm dialog + `deleted` emit; all confirm-dialog/toast copy is `LinkDetailView.vue`'s Link-delete copy with "Link" replaced by "QR-Code" ("QR-Code löschen?" / "QR-Code gelöscht" / "QR-Code konnte nicht gelöscht werden.")
- `QrCodesView.vue`'s `handleDeleted` removes the deleted card from `qrCodes.value` and reselects the first remaining card (or `null` when empty); no second toast — the panel's existing `@toast` binding already surfaces it

## Task Commits

Each task was committed atomically (TDD RED → GREEN per task):

1. **Task 1: Backend DELETE /api/qr-codes/:id route + integration tests**
   - `6c0302e` test(260724-d6y-01): add failing DELETE /api/qr-codes/:id integration tests
   - `bf7e207` feat(260724-d6y-01): add DELETE /api/qr-codes/:id route (WR-07)
2. **Task 2: Frontend deleteQrCode client + QrStudioPanel delete action wired to QrCodesView**
   - `5c4bbf4` test(260724-d6y-01): add failing delete-flow tests for QR Studio + QrCodesView
   - `5c8265b` feat(260724-d6y-01): add QR Studio delete action (WR-07)

_Note: this quick task's plan file lives at `.planning/quick/260724-d6y-add-delete-path-for-qr-codes/260724-d6y-PLAN.md`._

## Files Created/Modified

- `apps/api/src/routes/qrCodes.ts` — added `app.delete("/api/qr-codes/:id", ...)` immediately after the GET `:id` handler
- `apps/api/test/qrCodes.integration.test.ts` — new `DELETE /api/qr-codes/:id` describe block (5 tests: happy path, 404-nonexistent, 404-forbidden/IDOR, 401, cascade)
- `apps/web/src/api.ts` — new `deleteQrCode(id)` client function
- `apps/web/src/components/QrStudioPanel.vue` — `deleted` emit, `showDeleteDialog` ref, `requestDelete`/`cancelDelete`/`confirmDelete` handlers, delete button + confirm-dialog template block + matching scoped CSS
- `apps/web/src/components/QrStudioPanel.test.ts` — 4 new tests under a `delete action (WR-07)` describe block
- `apps/web/src/views/QrCodesView.vue` — `handleDeleted(id)` + `@deleted="handleDeleted"` binding on `<QrStudioPanel>`
- `apps/web/src/views/QrCodesView.test.ts` — 2 new tests under a `delete flow (WR-07)` describe block

## Decisions Made

- The DELETE route reuses `resolveOwnedQrCode` unchanged — no new authorization logic was written, matching the plan's threat-model disposition (T-WR07-01: mitigate via the existing IDOR guard).
- No `prisma.qrRemapHistory.delete` call was added anywhere — the cascade test (`apps/api/test/qrCodes.integration.test.ts`) is the proof that the schema-level FK (`onDelete: Cascade`, schema.prisma) alone handles cleanup.
- All new UI copy is a mechanical Link → QR-Code substitution of `LinkDetailView.vue`'s existing Link-delete dialog/toast strings — no new wording was invented, per the plan's explicit instruction.

## Deviations from Plan

None — plan executed exactly as written. Both tasks followed the plan's TDD (RED → GREEN) sequence, file list, and behavior spec verbatim.

## Issues Encountered

- This working directory had other quick-task executions running concurrently in parallel (260724-d5o, 260724-d72), which occasionally produced transient/interleaved test failures during a full `pnpm -r test` / `pnpm --filter @kurzly/api test` run (env.test.ts, redirect.integration.test.ts, and a WR-09 QR_ALREADY_EXISTS test unrelated to this plan). Re-running the API suite in isolation afterward confirmed 44/44 test files and 551/551 tests green — those failures were not caused by this plan's changes. All of this plan's own targeted suites (`qrCodes.integration`, `QrStudioPanel`, `QrCodesView`) and the full `apps/web` suite passed cleanly on every run.
- `apps/api`'s Prisma client had not yet been generated in this environment (`src/generated/prisma` was missing) before the first test run; ran `prisma generate` with a placeholder `DATABASE_URL` (the project's documented boot-time workaround, per STATE.md's Phase 1 decision) to unblock — no code change, environment-only.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- WR-07 (QR codes had no delete path) is closed. QR lifecycle now supports create/style/remap/export/delete.
- WR-09 (one-static-QR-per-link uniqueness) remains explicitly out of scope for this task and is being handled by a separate parallel quick task (260724-d72), observed landing concurrently in the same repo during this session.

---
*Quick task: 260724-d6y-add-delete-path-for-qr-codes*
*Completed: 2026-07-24*

## Self-Check: PASSED

All 7 modified files confirmed present on disk; all 4 task commit hashes (6c0302e, bf7e207, 5c4bbf4, 5c8265b) confirmed in git log.
