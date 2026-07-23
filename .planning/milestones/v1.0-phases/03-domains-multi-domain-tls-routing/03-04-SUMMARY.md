---
phase: 03-domains-multi-domain-tls-routing
plan: 04
subsystem: ui
tags: [vue3, vite, vue-router, fetch, component-testing]

# Dependency graph
requires:
  - phase: 03-domains-multi-domain-tls-routing (plan 01)
    provides: POST/GET /api/domains, DomainDTO shared type
  - phase: 03-domains-multi-domain-tls-routing (plan 02)
    provides: POST /:id/verify, DELETE /:id, GET /:id/instructions, admin+-gated
provides:
  - apps/web/src/api.ts — createDomain/listDomains/verifyDomain/deleteDomain/getDomainInstructions typed client fns, ApiError class carrying HTTP status
  - apps/web/src/views/DomainsView.vue — the Domains screen (860px container: list/add/verify/instructions/delete-confirm/empty)
  - /domains route now renders DomainsView (was ComingSoonView)
affects: [05-redirect-engine, 09-team-domain-assignment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ApiError extends Error and carries response.status — lets view-layer callers branch on specific HTTP codes (409 duplicate, 429 rate-limited) without re-parsing statusText; all existing api.ts throw sites migrated to it (backward-compatible, still `instanceof Error`)"
    - "DomainsView's per-domain 'verifyError' is a transient (non-persisted) UI-only field distinct from the server-persisted lastCheckError — keeps the immediate inline verify-failure message separate from the durable 'Zuletzt geprüft' history line"

key-files:
  created:
    - apps/web/src/views/DomainsView.vue
    - apps/web/test/DomainsView.test.ts
  modified:
    - apps/web/src/api.ts
    - apps/web/src/router/index.ts

key-decisions:
  - "Imported DomainDTO directly from @kurzly/shared (not a locally-redeclared DomainDto) — the plan's action text explicitly calls for this, and it keeps the client/view in lockstep with the server's toDomainDto() shape without a second source of truth"
  - "parseJsonOrThrow and deleteDomain's manual non-ok check both now throw ApiError (extends Error, adds `.status`) instead of a bare Error — required so handleAddDomain/handleVerify can map 409/429 to the exact D-01-locked copy without string-matching statusText; every existing call site (getCanary/getSession/logout) is unaffected since ApiError IS-A Error"
  - "Verify failure (DNS-mismatch or 429) surfaces as an inline message under the domain row (new `.verify-error-row`), never a toast — success is the only verify outcome that toasts, matching 03-UI-SPEC.md's DNS-Verify-Interaction contract distinguishing toast-on-success from inline-on-failure"

requirements-completed: [DOMAIN-01, DOMAIN-02, DOMAIN-04]

coverage:
  - id: D1
    description: "/domains renders DomainsView (replacing ComingSoonView) at an 860px container with list/add/verify/instructions/delete/empty-state, driving the Phase-3 API"
    requirement: "DOMAIN-01"
    verification:
      - kind: automated_ui
        ref: "apps/web/test/DomainsView.test.ts — renders the empty state when listDomains resolves to []"
        status: pass
      - kind: automated_ui
        ref: "apps/web/test/DomainsView.test.ts — renders each domain's hostname, type badge, and status badge label"
        status: pass
      - kind: unit
        ref: "pnpm --filter @kurzly/web exec tsc --noEmit && pnpm --filter @kurzly/web build"
        status: pass
    human_judgment: false
  - id: D2
    description: "Adding a domain calls createDomain({hostname,type}), appends the pending row + toast; a 409 duplicate maps to the D-01-locked German copy"
    requirement: "DOMAIN-01"
    verification:
      - kind: automated_ui
        ref: "apps/web/test/DomainsView.test.ts — adding a domain calls createDomain with { hostname, type } and appends the new pending row + shows a toast"
        status: pass
      - kind: automated_ui
        ref: "apps/web/test/DomainsView.test.ts — maps a 409 createDomain error to the duplicate-domain copy"
        status: pass
    human_judgment: false
  - id: D3
    description: "'Jetzt prüfen' calls verifyDomain and flips the status badge to Aktiv on success"
    requirement: "DOMAIN-02"
    verification:
      - kind: automated_ui
        ref: "apps/web/test/DomainsView.test.ts — clicking 'Jetzt prüfen' calls verifyDomain and updates the badge to Aktiv on a resolved active result"
        status: pass
    human_judgment: false
  - id: D4
    description: "DNS-instructions accordion fetches getDomainInstructions on first open and renders the CNAME/A record + copy-to-clipboard button + the D-01 TLS hint ('nicht Kurzly')"
    requirement: "DOMAIN-04"
    verification:
      - kind: automated_ui
        ref: "apps/web/test/DomainsView.test.ts — toggling the instructions accordion calls getDomainInstructions and renders the record + a copy button"
        status: pass
    human_judgment: false
  - id: D5
    description: "Deleting a domain requires confirmation — the delete icon opens a dialog and deleteDomain is only called after 'Entfernen' is confirmed (never on the icon click itself)"
    requirement: "DOMAIN-02"
    verification:
      - kind: automated_ui
        ref: "apps/web/test/DomainsView.test.ts — the delete icon opens the confirmation dialog and does NOT call deleteDomain until confirmed"
        status: pass
      - kind: automated_ui
        ref: "apps/web/test/DomainsView.test.ts — clicking 'Abbrechen' closes the confirmation dialog without deleting"
        status: pass
    human_judgment: false
  - id: D6
    description: "Domains screen reproduces the locked design tokens pixel-for-pixel (Geist fonts, #d7ff01 accent, 860px container, spacing/radii) at 1440px in Light and Dark against the prototype (UI-03)"
    human_judgment: true
    rationale: "Pixel-fidelity is a visual/manual gate per UI-03 and the Design-Fidelity Waiver — component tests assert DOM structure/text/behavior but cannot verify rendered pixel exactness against Kurzly Prototyp.dc.html; requires /gsd-verify-work's UI review pass (see 'UI-03 Manual Gate' note below)."

duration: ~15min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 4: Domains frontend slice — DomainsView + typed API client Summary

**DomainsView.vue (860px container) replaces ComingSoonView at /domains — full list/add/verify/DNS-instructions/copy/delete-confirm/empty-state UI driving the Phase-3 backend via five new typed api.ts client functions, with an `ApiError` class enabling exact 409/429 copy mapping; 8 new @vue/test-utils component tests green.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-11T16:04:00Z (approx.)
- **Completed:** 2026-07-11T16:19:16Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `apps/web/src/api.ts` gained `createDomain`/`listDomains`/`verifyDomain`/`deleteDomain`/`getDomainInstructions`, typed against the shared `DomainDTO`, plus a new `ApiError` class (extends `Error`, carries `.status`) so the view can branch on 409 (duplicate) vs 429 (rate-limited) vs generic failure without parsing `statusText`
- `apps/web/src/views/DomainsView.vue` — the full Domains screen at 860px max-width (not the generic 1060px `.screen-container`): domain list with Geist-Mono hostname (230px ellipsis), uppercase type badge, three-state status badge (Aktiv accent-pill / DNS ausstehend chip / Fehlgeschlagen chip+red-text), add-domain row with an auto-preselecting (overridable) Subdomain/Apex toggle, "Jetzt prüfen" verify action (loading label, inline error on failure, toast on success), per-domain DNS-instructions accordion with a copy-to-clipboard `⧉` button and the D-01-worded TLS hint ("... TLS terminiert dein eigener Proxy, nicht Kurzly."), a "Zuletzt geprüft" line, a 380px delete-confirmation modal (no immediate delete), an empty state, and the global bottom-center toast pattern
- `apps/web/src/router/index.ts` — `/domains` now renders `DomainsView`; the other four `ComingSoonView` routes (links/qr-codes/analytics/team) are untouched
- `apps/web/test/DomainsView.test.ts` — 8 component tests (empty state, per-status badges, add+toast, verify→Aktiv, instructions accordion+copy-button+TLS-hint-copy, delete-confirm-gates-the-call, cancel-leaves-row-intact, 409→duplicate-copy)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend the typed API client with domain CRUD/verify/instructions functions** - `84ebacb` (feat)
2. **Task 2: Build DomainsView.vue (860px, list/add/verify/instructions/delete/empty) and swap the /domains route** - `864877b` (feat)
3. **Task 3: @vue/test-utils component suite for DomainsView** - `cdbe0cf` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `apps/web/src/api.ts` - Added `ApiError` class + `createDomain`/`listDomains`/`verifyDomain`/`deleteDomain`/`getDomainInstructions`; migrated all existing throw sites (`parseJsonOrThrow`, `logout`) to `ApiError` for consistency
- `apps/web/src/views/DomainsView.vue` (new) - The Domains screen per 03-UI-SPEC.md
- `apps/web/src/router/index.ts` - `/domains` route's `component` swapped from `ComingSoonView` to `DomainsView`
- `apps/web/test/DomainsView.test.ts` (new) - 8-test `@vue/test-utils` component suite, mocked `../src/api`

## Decisions Made
- `DomainDTO` (from `@kurzly/shared`) is used directly as the view's domain model rather than a redeclared local `DomainDto` — one source of truth for the DTO shape across api.ts and DomainsView.vue, per the plan's explicit action text.
- `parseJsonOrThrow` and `deleteDomain`'s manual non-ok check now throw a shared `ApiError` (extends `Error`, adds `.status: number`) instead of a bare `Error` — the only way `handleAddDomain`/`handleVerify` can branch on the exact 409/429 status codes the plan's copy contract requires (`Diese Domain ist bereits registriert.` / `Zu viele Prüfungen. ...`) without brittle `statusText` string-matching. All prior `throw new Error(...)` call sites in `api.ts` (`getCanary`, `getSession`, `logout`) were migrated to `ApiError` too for consistency — behaviorally identical (`instanceof Error` still true, same message text), zero test breakage.
- Verify failures (DNS-mismatch or 429-rate-limited) render as an inline message under the domain row (`.verify-error-row`, new, styled like the "Zuletzt geprüft" error color) rather than a toast — only a successful verify toasts (`"{domain} verifiziert ✓"`). This follows 03-UI-SPEC.md's DNS-Verify-Interaction section literally: "Bei Erfolg: ... Toast ...", "Bei Fehlschlag: ... Inline-Meldung ...", "Bei Rate-Limit: Inline-Meldung ... statt der generischen Fehlschlag-Meldung."
- Screen-header CSS (`display:flex; align-items:center; gap:14px`) was reproduced literally from the UI-SPEC's Layout Contract rather than switched to `flex-direction:column` (which the pattern-mapper's reference implementation used) — the spec block doesn't specify `flex-direction`, and Phase 2's `ComingSoonView`/`DashboardView` reuse the same literal block for their headers; kept consistent with that established row-default rather than introducing an undocumented deviation. Flagged for the UI-03 manual pixel-fidelity gate below in case the prototype visually stacks title/subtitle.

## Deviations from Plan

None — plan executed as written. The `ApiError` class is an implementation detail needed to satisfy the plan's own explicit acceptance criteria (409/429 copy mapping called for in Task 2's action text) rather than an unplanned addition; it required no separate deviation entry since it's the direct, minimal mechanism for delivering what Task 2 already specified.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## UI-03 Manual Gate (flag for /gsd-verify-work)

Per 03-UI-SPEC.md and the project's standing UI-03 pixel-fidelity requirement, this plan's automated component tests prove **behavior** (DOM structure, event wiring, copy text) but NOT **rendered pixel exactness**. The Domains screen (list/add/verify/instructions/delete-confirm/empty states, Light + Dark) still needs a manual visual pass at 1440px against `Kurzly Prototyp.dc.html` before this plan's UI-03 obligation is considered fully discharged — route this through `/gsd-verify-work` or `/gsd-ui-review`. Nothing in this plan blocks that gate; it is called out here so it isn't silently skipped.

## Next Phase Readiness
- DOMAIN-01/02/04 are now fully user-facing: an admin can add, verify, read DNS instructions for, copy, and remove domains from the dashboard.
- `apps/web/src/api.ts`'s `ApiError` class is a stable, reusable export for any future typed client function needing status-code-aware error handling (e.g. Links/QR-Codes screens in later phases).
- Phase 3 (domains-multi-domain-tls-routing) is now fully executed (03-01 through 03-04); the redirect engine (Phase 5) can build on the complete Domain lifecycle + `resolveActiveDomainByHost` (03-03) + this frontend slice.
- No blockers.

---
*Phase: 03-domains-multi-domain-tls-routing*
*Completed: 2026-07-11*

## Self-Check: PASSED

All created/modified files verified present on disk (api.ts, DomainsView.vue, router/index.ts, DomainsView.test.ts, this SUMMARY). All 3 task commit hashes (84ebacb, 864877b, cdbe0cf) verified present in `git log --oneline --all`.
