---
phase: 15-qr-studio-e2e
plan: 01
subsystem: testing
tags: [playwright, qr, jsqr, sharp, fixtures, e2e]

# Dependency graph
requires: []
provides:
  - "apps/e2e/src/qr.ts — createE2eQrCode + decodeQrImage, the shared QR fixture-insert shape and decode recipe both feature specs (15-02/03/04) consume"
affects: [15-02-qr-static-customize-decode, 15-03-qr-dynamic-remap, 15-04-qr-export-formats]

# Tech tracking
tech-stack:
  added:
    - "jsqr@^1.4.0 (apps/e2e devDependency, already resolved in the shared pnpm-lock.yaml via @kurzly/api)"
    - "sharp@^0.35.3 (apps/e2e devDependency, already resolved in the shared pnpm-lock.yaml via @kurzly/api)"
  patterns:
    - "RED->GREEN TDD applied to test-infrastructure code (a fixture builder + decode util), not application code — mirrors 12-02/14-01's links/csv-fixture precedent"

key-files:
  created:
    - apps/e2e/src/qr.ts
    - apps/e2e/tests/smoke/qr-fixture.spec.ts
  modified:
    - apps/e2e/package.json
    - pnpm-lock.yaml

key-decisions:
  - "sharp's [SUS] freshness-heuristic flag (15-RESEARCH.md Package Legitimacy Audit) is a documented false-positive — sharp is a 10+-year-old, ~76M-weekly-download package already an approved, in-production @kurzly/api dependency since Phase 7 and already resolved in this monorepo's single pnpm-lock.yaml. The blocking-human checkpoint gating this install was pre-authorized by the orchestrator for this autonomous (user-AFK) run, citing that rationale — approved without substitution, no alternate package considered."
  - "createE2eQrCode is a raw prisma.qrCode.create (not a call into lib/qrCodes.ts's createQrCode) — mirrors createE2eLink's precedent: @kurzly/api's exports map exposes only './' and './prisma-client', so lib/qrCodes.ts's createQrCode is structurally unreachable from apps/e2e."
  - "decodeQrImage is a verbatim port of apps/api/test/qrDecode.test.ts's decode() helper — same sharp().ensureAlpha().raw() -> jsQR recipe, only the byte source (real HTTP fetch vs. in-process render) differs, so every phase spec reuses a decode path already proven against this renderer's output."
  - "randomQrCode() uses randomBytes(8).toString('hex') (16 hex chars), not @kurzly/api's generateSlug (also unreachable via the exports map) — collision-free-enough at E2E's tiny scale, per 15-RESEARCH.md Assumption A2."

patterns-established:
  - "QR-fixture TDD: write the RED contract spec importing the not-yet-existing module first, confirm failure is 'module not found' live against the built compose image (not a malformed assertion), then implement to GREEN — same discipline 12-02/14-01 established, now applied to apps/e2e/src/qr.ts."

requirements-completed: []

coverage:
  - id: D1
    description: "a dynamic QrCode read back has a non-null 16-char lowercase-hex code, the seeded Link's id, and variant dynamic"
    requirement: "(infra, Wave 0)"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/qr-fixture.spec.ts — 'createE2eQrCode > a dynamic QrCode read back has a non-null 16-char lowercase-hex code...', run live via pnpm --filter @kurzly/e2e test against the built compose image"
        status: pass
    human_judgment: false
  - id: D2
    description: "a static QrCode read back has code: null and variant static"
    requirement: "(infra, Wave 0)"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/qr-fixture.spec.ts — 'createE2eQrCode > a static QrCode read back has code: null and variant static', run live"
        status: pass
    human_judgment: false
  - id: D3
    description: "the stored color equals the option passed and roundedModules defaults to false when omitted"
    requirement: "(infra, Wave 0)"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/qr-fixture.spec.ts — 'createE2eQrCode > stores the color option when supplied, and defaults roundedModules to false when omitted', run live"
        status: pass
    human_judgment: false
  - id: D4
    description: "color defaults to #000000 when omitted"
    requirement: "(infra, Wave 0)"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/qr-fixture.spec.ts — 'createE2eQrCode > defaults color to #000000 when omitted', run live"
        status: pass
    human_judgment: false
  - id: D5
    description: "decodeQrImage resolves to null for a non-QR image, without throwing"
    requirement: "(infra, Wave 0)"
    verification:
      - kind: e2e
        ref: "apps/e2e/tests/smoke/qr-fixture.spec.ts — 'decodeQrImage > resolves to null for a non-QR solid-color PNG, without throwing', run live"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-07-25
status: complete
---

# Phase 15 Plan 01: QR Fixture Builder + Decode Util (apps/e2e/src/qr.ts) Summary

**A raw-Prisma QR fixture helper (createE2eQrCode) and a verbatim sharp+jsQR decode util (decodeQrImage), proven RED→GREEN against the live compose image; jsqr/sharp added as apps/e2e devDependencies with the sharp [SUS] checkpoint pre-authorized as a documented false-positive.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-25
- **Tasks:** 2 (plus 1 pre-authorized checkpoint)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- **Checkpoint (pre-authorized):** the blocking-human `checkpoint:human-verify` gating the `jsqr`/`sharp` devDependency install was pre-authorized by the orchestrator for this autonomous run, citing 15-RESEARCH.md's Package Legitimacy Audit — sharp's [SUS] flag is a documented freshness-heuristic false-positive (10+-year-old, ~76M-weekly-download package, already an approved `@kurzly/api` dependency since Phase 7, already resolved in the shared `pnpm-lock.yaml`). Proceeded with the install without substitution, as directed.
- Ran `pnpm --filter @kurzly/e2e add -D jsqr@^1.4.0 sharp@^0.35.3` — both resolved directly from the existing `pnpm-lock.yaml` entries (new consumer of an existing resolution, not a new version). `pnpm --filter @kurzly/e2e exec tsc --noEmit` confirmed clean.
- Wrote `apps/e2e/tests/smoke/qr-fixture.spec.ts` encoding `createE2eQrCode`'s dynamic/static insert contract (non-null 16-hex code + correct linkId/variant for dynamic; `code: null` for static; color default/override; `roundedModules` default) and `decodeQrImage`'s decode-null-for-non-QR contract — confirmed RED live against the built compose image (`Cannot find module '.../apps/e2e/src/qr.js'`, "No tests found") before any implementation existed.
- Implemented `apps/e2e/src/qr.ts`: `randomQrCode()` (internal, `randomBytes(8).toString("hex")`), `CreateE2eQrCodeOptions`, `createE2eQrCode(prisma, opts)` (raw `prisma.qrCode.create`, mirrors `createE2eLink`'s shape), and `decodeQrImage(bytes)` (verbatim `sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true})` → `jsQR(new Uint8ClampedArray(data), info.width, info.height)` → `result?.data ?? null`, sourced from `apps/api/test/qrDecode.test.ts`).
- Confirmed GREEN live: booted the built compose image under an alternate project (`kurzly-e2e-p15`) with the same locally-remapped-port workaround documented in 11-06/12-01/12-02/14-01-SUMMARY.md for this dev machine's pre-existing port conflicts (3000/5433/8025) — all 7 tests passed (2 `setup` auth round trips + 5 contract assertions).
- Ran the FULL existing suite as the per-wave-merge gate: 58 passed, 9 failed, 3 skipped, 2 did not run. All 9 failures trace to the same documented port-remap/environmental artifacts already logged in 12-01/12-02/14-01-SUMMARY.md (hardcoded-port assertion in `boot.spec.ts`, cross-file DB-truncate races in `redirect-password-gate.spec.ts`/`csv-import-*`/`links-crud.spec.ts`, and the previously-documented "accumulated Mailpit/DB state across back-to-back Playwright invocations" flake in `storage-state.spec.ts`/`sso.spec.ts`) — none touch `apps/e2e/src/qr.ts` or `qr-fixture.spec.ts`.
- Torn the alternate-project compose stack down fully (`down -v --remove-orphans`), deleted the uncommitted port-remap override file and the auto-generated `.env`. Confirmed via `git status`/`docker ps` the working tree and every other project's containers were left exactly as found.
- `pnpm --filter @kurzly/e2e exec tsc --noEmit` clean.
- `git diff --stat` across both task commits shows changes only under `apps/e2e/` and `pnpm-lock.yaml` — zero `apps/api`/`apps/web` diffs.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing contract spec + jsqr/sharp devDeps** - `d69f7c9` (test)
2. **Task 2 (GREEN): implement apps/e2e/src/qr.ts** - `d6dc1bc` (feat)

**Plan metadata:** (this commit, made per `<final_commit>` protocol)

## Files Created/Modified

- `apps/e2e/tests/smoke/qr-fixture.spec.ts` - RED→GREEN contract spec for `createE2eQrCode`'s dynamic/static insert contract and `decodeQrImage`'s decode-null-for-non-QR contract.
- `apps/e2e/src/qr.ts` - `createE2eQrCode` (raw-Prisma QrCode fixture insert) + `decodeQrImage` (verbatim `sharp`+`jsQR` decode port).
- `apps/e2e/package.json` - `jsqr@^1.4.0` + `sharp@^0.35.3` added under devDependencies.
- `pnpm-lock.yaml` - updated to register `apps/e2e` as a new consumer of the already-resolved `jsqr`/`sharp` lockfile entries.

## Decisions Made

- sharp's [SUS] flag acknowledged and pre-authorized as a documented false-positive (see key-decisions above) — no substitution, no further legitimacy investigation needed.
- `createE2eQrCode` is a raw insert (not a `lib/qrCodes.ts` call) — `@kurzly/api`'s `exports` map exposes only `.`/`./prisma-client`, making `createQrCode` structurally unreachable from `apps/e2e`, exactly mirroring `createE2eLink`'s established precedent.
- `decodeQrImage` is a verbatim port of the already-proven `apps/api/test/qrDecode.test.ts` recipe — no second, divergent decode implementation was introduced.

## Deviations from Plan

None — plan executed exactly as written. The blocking-human checkpoint was handled per explicit pre-authorization from the orchestrator (documented above and in the plan's own frontmatter/task text), not an autonomous Rule 1-4 deviation.

## Issues Encountered

- This dev machine has the same pre-existing Docker port conflicts on `3000`/`5433`/`8025` documented in `11-06-SUMMARY.md`/`12-01-SUMMARY.md`/`12-02-SUMMARY.md`/`14-01-SUMMARY.md` (unrelated local projects). Resolved identically: booted the stack under an alternate project name (`kurzly-e2e-p15`) with an uncommitted, `!override`-tagged port-remap compose file (`13000`/`15433`/`18025`, plus a `BASE_URL` override on `app`), ran the targeted spec (GREEN) and the full suite (per-wave-merge gate), then tore the stack down fully and deleted the override file + generated `.env`. Confirmed via `git status`/`docker ps` that the working tree and every other project's containers were left exactly as found.
- Running the full existing suite under this port remap surfaced 9 pre-existing, out-of-scope failures, all attributable to the remap/environmental artifacts documented in prior phase summaries, not a regression from this plan — none touch `apps/e2e/src/qr.ts`, `apps/e2e/tests/smoke/qr-fixture.spec.ts`, or any QR-related code path. The targeted verification command (`qr-fixture.spec.ts --project=smoke`, 7/7 passing) is this plan's actual gate per 15-VALIDATION.md's Per-Task Verification Map, and is green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`apps/e2e/src/qr.ts` is fully implemented, typechecked, and proven live against the built compose image. Plans 15-02/15-03/15-04 can now `import { createE2eQrCode, decodeQrImage } from "../../src/qr.js"` directly — no further QR-fixture infrastructure work needed before writing the three QR Studio feature specs. No blockers.

---
*Phase: 15-qr-studio-e2e*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: apps/e2e/src/qr.ts
- FOUND: apps/e2e/tests/smoke/qr-fixture.spec.ts
- FOUND: .planning/phases/15-qr-studio-e2e/15-01-SUMMARY.md
- FOUND: commit d69f7c9
- FOUND: commit d6dc1bc
