---
phase: 04-links-management-bulk-import
plan: 03
subsystem: api
tags: [fastify, prisma, zod, authorization, idor]

# Dependency graph
requires:
  - phase: 04-links-management-bulk-import
    provides: "04-02: lib/links.ts D-01 core (validateLinkInput/createLink/previewLink/updateLink) + POST/GET /api/links routes"
  - phase: 02-magic-link-auth-app-shell-domain-authorization-core
    provides: "requireDomainAccess/ForbiddenError frozen signatures (apps/api/src/lib/authorization.ts)"
provides:
  - "resolveOwnedLink(prisma, userId, id) — the shared IDOR guard: findUnique the Link, requireDomainAccess on its OWN domainId, null for both not-found and forbidden"
  - "GET /api/links/:id — detail (LinkDTO), IDOR-guarded (LINK-05)"
  - "PATCH /api/links/:id — edit target/title/slug via the validated updateLink core, excludeLinkId-aware, IDOR-guarded (LINK-06, D-04)"
  - "DELETE /api/links/:id — delete, IDOR-guarded (LINK-07)"
affects: [04-05-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IDOR guard for by-ID resources one join away from their authorization boundary: findUnique the resource, then requireDomainAccess on the resource's OWN foreign-key domainId inside a try/catch that maps ForbiddenError to the SAME not-found outcome as a missing row — closes the existence-oracle vector structurally, not just by convention"
    - "PATCH allowlist with omitted-field-keeps-current-value semantics: unset body fields fall back to the pre-fetched row's current value before being re-validated through the create-identical validation core, so a partial edit re-runs full validation without accidentally regenerating unrelated fields (e.g. omitting slug does NOT auto-generate a new one — it re-validates the link's own current slug via excludeLinkId)"

key-files:
  created: []
  modified:
    - apps/api/src/routes/links.ts
    - apps/api/test/links.integration.test.ts

key-decisions:
  - "resolveOwnedLink is a private helper (not exported) local to routes/links.ts — it is route-layer plumbing, not part of the D-01 validation core in lib/links.ts, so it stays out of the file whose header comment promises 'the single write-path core'."
  - "PATCH's Zod schema keeps title as nullable().optional() exactly as the plan specified, but updateLink's ValidatedLink.title type is string | undefined (no null variant) — an explicit null in the PATCH body currently resolves to 'keep the existing title' rather than 'clear it', since clearing would require touching lib/links.ts's update() call site, which this plan's files_modified scope (routes/links.ts + test file only) does not include. No test in this plan exercises title-clearing, so this is a known, intentionally out-of-scope limitation rather than a broken feature — flagged here for whoever picks up an explicit 'remove title' UI affordance later."
  - "A defensive NOT_FOUND branch was kept in the PATCH handler's error mapping even though resolveOwnedLink already proves the row exists before updateLink is called — updateLink's own UpdateLinkResult type includes NOT_FOUND for its own internal re-fetch, and TypeScript's exhaustiveness check on statusForLinkError (typed to LinkErrorCode only) requires the caller to narrow it out first. This keeps the total-mapping guarantee intact without widening statusForLinkError's signature."

patterns-established:
  - "resolveOwnedLink(prisma, userId, id) — reusable IDOR-guard shape for any future by-ID resource whose authorization boundary is one join away (e.g. QR codes in a later phase)."

requirements-completed: [LINK-05, LINK-06, LINK-07]

coverage:
  - id: D1
    description: "GET /api/links/:id returns the LinkDTO for a caller with member+ access to the link's own domain; 404 for a non-existent id and 404 (identical body) for a link the caller cannot access — no existence oracle"
    requirement: "LINK-05"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'GET /api/links/:id (route layer, IDOR guard — LINK-05)' describe block"
        status: pass
    human_judgment: false
  - id: D2
    description: "PATCH /api/links/:id edits targetUrl/title/slug through updateLink -> validateLinkInput (excludeLinkId-aware); reserved/collision/scheme rules identical to create; domainId/createdBy/id are not mass-assignable; IDOR-guarded"
    requirement: "LINK-06"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'PATCH /api/links/:id (route layer, D-04 same-rules-as-create — LINK-06)' describe block"
        status: pass
      - kind: other
        ref: "grep -c 'prisma.link.update' apps/api/src/routes/links.ts = 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "DELETE /api/links/:id removes the row and returns 204 for an accessible link; 404 and the row untouched for a non-existent or inaccessible id; IDOR-guarded"
    requirement: "LINK-07"
    verification:
      - kind: integration
        ref: "apps/api/test/links.integration.test.ts — 'DELETE /api/links/:id (route layer, IDOR guard — LINK-07)' describe block"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-11
status: complete
---

# Phase 4 Plan 03: Link Detail, Edit, Delete — IDOR Guard + Validated Update Summary

**GET/PATCH/DELETE /api/links/:id, all gated by a shared `resolveOwnedLink` findUnique-then-requireDomainAccess IDOR guard (404-for-both), with PATCH delegating every write through the same `updateLink`/`validateLinkInput` core as creation.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-11T22:10:26Z
- **Completed:** 2026-07-11T22:17:23Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `resolveOwnedLink(prisma, userId, id)` added to `apps/api/src/routes/links.ts`: `findUnique`s the Link, then `requireDomainAccess(prisma, userId, link.domainId, "member")`, returning `null` for BOTH not-found and forbidden — a caller can never distinguish "no such link" from "link exists, you can't access it" (T-04-IDOR, no existence oracle)
- `GET /api/links/:id` (LINK-05): 200 `LinkDTO` for an accessible link, 404 for both non-existent and inaccessible ids with an identical body, 401 with no session
- `DELETE /api/links/:id` (LINK-07): 204 + row removed for an accessible link, 404 + row untouched for non-existent/inaccessible ids, 401 with no session
- `PATCH /api/links/:id` (LINK-06, D-04): edits `targetUrl`/`title`/`slug` by delegating to `updateLink` — the same `validateLinkInput` core `POST /api/links` uses, with `excludeLinkId` set so re-saving a link's own current slug never false-collides. A Zod allowlist (`targetUrl?`, `slug?`, `title?`) excludes `domainId`/`createdBy`/`id` (T-04-MASS); the domain stays immutable, carried forward from the already-authorized `resolveOwnedLink` result. Reserved-slug → 400, cross-link collision → 409, `javascript:` scheme → 400, all leaving the persisted row unchanged; IDOR-forbidden PATCH → 404, row unchanged
- `grep -c "prisma.link.update" apps/api/src/routes/links.ts` = 0 — the route layer never calls Prisma's update directly, proven structurally
- 15 new integration tests added (7 GET/DELETE, 8 PATCH), all asserting persisted DB state after each mutation, not just the HTTP response; full `apps/api` suite (130 tests) and workspace-wide `tsc --noEmit` both green

## Task Commits

Each task was committed as a TDD RED/GREEN pair per this plan's `type: tdd`:

1. **Task 1: GET /api/links/:id + DELETE /api/links/:id with the IDOR guard (404-for-both)** - `45f08a7` (test, RED) + `189b95b` (feat, GREEN)
2. **Task 2: PATCH /api/links/:id — edit target/title/slug through the validated core (D-04)** - `64e49b1` (test, RED) + `1db2e1d` (feat, GREEN)

**Plan metadata:** (this commit, docs: complete plan)

## TDD Gate Compliance

RED (`test(...)`) and GREEN (`feat(...)`) commits are present in order for both tasks (`45f08a7` → `189b95b`; `64e49b1` → `1db2e1d`). Every RED-phase test run showed at least the intended failures (404 in place of the expected 200/204/400/409/401) before the corresponding GREEN implementation was written; no test passed unexpectedly ahead of its implementation.

## Files Created/Modified
- `apps/api/src/routes/links.ts` - added `resolveOwnedLink` IDOR-guard helper, `updateLinkSchema`, and the `GET`/`PATCH`/`DELETE /api/links/:id` route handlers to the existing `linksRoute` factory
- `apps/api/test/links.integration.test.ts` - added `GET /api/links/:id`, `DELETE /api/links/:id`, and `PATCH /api/links/:id` describe blocks (LINK-05/06/07 + IDOR-guard cases)

## Decisions Made
- `resolveOwnedLink` lives in `routes/links.ts` (route-layer plumbing), not `lib/links.ts` (the D-01 validation core) — it composes `requireDomainAccess` with a link-specific lookup and isn't itself a validation rule shared with the CSV importer.
- PATCH's Zod schema keeps `title: z.string().max(200).nullable().optional()` exactly as specified, but an explicit `null` currently resolves to "keep the existing title" rather than "clear it," since `updateLink`'s `ValidatedLink.title` type has no `null` variant and this plan's `files_modified` scope excludes `lib/links.ts`. No test in this plan exercises title-clearing — documented as a known limitation for a future explicit "remove title" affordance, not a defect against this plan's `must_haves`.
- Kept a defensive `NOT_FOUND` branch in PATCH's error mapping (unreachable in practice since `resolveOwnedLink` already proved the row exists) to satisfy `updateLink`'s `UpdateLinkResult` type and keep `statusForLinkError`'s exhaustiveness check total without widening its signature.

## Deviations from Plan

None - plan executed exactly as written. One authoring-time self-correction (not a deviation from plan behavior): the PATCH route's original inline comment literally contained the substring `prisma.link.update` inside prose explaining why the route does NOT call it, which the plan's own `grep -c "prisma.link.update" apps/api/src/routes/links.ts` = 0 verification command matched as a false positive against comment text. Reworded the comment (no code change) so the grep-assert passes on actual call sites only.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 04-04 (CSV bulk import) can proceed independently — it consumes `createLink`/`previewLink` from `lib/links.ts` (04-02), unaffected by this plan's route-layer additions.
- 04-05 (frontend detail/edit/delete UI) has a complete, tested backend surface to build against: `GET/PATCH/DELETE /api/links/:id`, all IDOR-guarded, PATCH enforcing the same slug/reserved/scheme rules as create with a clear 400/409/404 status mapping the UI can branch on.
- No blockers or concerns carried forward.

---
*Phase: 04-links-management-bulk-import*
*Completed: 2026-07-11*

## Self-Check: PASSED

- FOUND: apps/api/src/routes/links.ts
- FOUND: apps/api/test/links.integration.test.ts
- FOUND: .planning/phases/04-links-management-bulk-import/04-03-SUMMARY.md
- FOUND commit: 45f08a7
- FOUND commit: 189b95b
- FOUND commit: 64e49b1
- FOUND commit: 1db2e1d
