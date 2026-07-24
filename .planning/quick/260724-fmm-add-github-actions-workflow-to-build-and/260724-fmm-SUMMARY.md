---
phase: quick-260724-fmm
plan: 01
subsystem: infra
tags: [github-actions, ci, docker, ghcr, deployment]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: multi-stage Dockerfile, docker-compose.yml, .github/workflows/ci.yml (test + smoke jobs)
provides:
  - GHCR publish job in ci.yml, gated on test+smoke passing and main-only pushes
  - docs/DEPLOYMENT.md Section 6 documenting the publish/pull flow
affects: [deployment, ci, docs/DEPLOYMENT.md]

# Tech tracking
tech-stack:
  added: [docker/setup-buildx-action@v4, docker/login-action@v4, docker/metadata-action@v6, docker/build-push-action@v7]
  patterns: ["Same-workflow-file job gating via needs: [] rather than workflow_run for cross-job CI-success gating"]

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml
    - docs/DEPLOYMENT.md

key-decisions:
  - "publish job lives in the same ci.yml file (not a separate docker-publish.yml) so needs: [test, smoke] can gate it directly on CI success"
  - "Three tags published: latest, main, sha-<short> — the immutable sha tag mitigates floating-latest ambiguity (T-fmm-02)"
  - "Job-scoped permissions: {contents: read, packages: write} instead of inheriting repo-default token scopes (T-fmm-04)"
  - "if: github.event_name == 'push' && github.ref == 'refs/heads/main' is the primary fork-safety guard, skipping the job on all PRs and non-main pushes (T-fmm-01)"

patterns-established:
  - "GHCR image inherits repo private visibility automatically via GITHUB_TOKEN push — no extra visibility config needed"

requirements-completed: [CI-PUBLISH-01]

coverage:
  - id: D1
    description: "publish job added to ci.yml: needs [test, smoke], main-only if guard, job-scoped packages:write permission, pinned docker/* actions (v4/v4/v6/v7), three tags (latest/main/sha-<short>) to ghcr.io/zebra-group/zack"
    requirement: "CI-PUBLISH-01"
    verification:
      - kind: other
        ref: "yq '.' .github/workflows/ci.yml (YAML validity) + structural grep checks for needs/if/permissions/action versions/tags"
        status: pass
    human_judgment: false
  - id: D2
    description: "Real GHCR publish confirmed end-to-end: push to main triggers test -> smoke -> publish all green, package exists with latest/main/sha-* tags, authenticated docker pull succeeds, non-main/PR events skip publish"
    requirement: "CI-PUBLISH-01"
    verification: []
    human_judgment: true
    rationale: "GitHub Actions workflow behavior cannot be verified locally (no act/actionlint installed in this environment); definitive proof requires a real push to main and gh run watch, which per this quick task's execution constraints is performed by the orchestrator after this plan's commits land, not by the executor."
  - id: D3
    description: "docs/DEPLOYMENT.md Section 6 documents the GHCR publish trigger, three tags, authenticated private-image pull (read:packages PAT), and pull-vs-build-locally alternative"
    requirement: "CI-PUBLISH-01"
    verification:
      - kind: other
        ref: "grep checks for ghcr.io/zebra-group/zack, docker pull, read:packages, sha-, private in docs/DEPLOYMENT.md"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-24
status: complete
---

# Phase quick-260724-fmm Plan 01: Add GHCR publish job to CI Summary

**Extended `.github/workflows/ci.yml` with a main-only, test+smoke-gated `publish` job that builds the repo's existing multi-stage Dockerfile and pushes `latest`/`main`/`sha-<short>` tags to `ghcr.io/zebra-group/zack`, plus a new DEPLOYMENT.md section documenting the pull flow.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-24T09:21:20Z
- **Completed:** 2026-07-24
- **Tasks:** 2 of 3 fully executed by this agent (Task 3's definitive real-CI verification is explicitly deferred to the orchestrator per this quick task's execution constraints)
- **Files modified:** 2

## Accomplishments
- Added a `publish` job to `ci.yml`: `needs: [test, smoke]`, `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`, job-scoped `permissions: {contents: read, packages: write}`, and the four pinned docker actions (setup-buildx@v4, login@v4, metadata@v6, build-push@v7) producing exactly three tags (`latest`, `main`, `sha-<short>`) to `ghcr.io/zebra-group/zack`.
- Documented the new publish/pull flow in `docs/DEPLOYMENT.md` as a new Section 6, with a one-sentence forward-pointer added to Section 2, covering the publish trigger, the three tags, the authenticated `docker pull` flow for the private image (`read:packages` PAT), and the pull-vs-build-locally alternative.
- Confirmed `ci.yml` parses as valid YAML locally and passed every structural grep check specified in the plan's verification blocks.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the GHCR publish job to ci.yml** - `76981fb` (feat)
2. **Task 2: Document the GHCR publish/pull flow in DEPLOYMENT.md** - `a22c687` (docs)
3. **Task 3: Validate the workflow and confirm a real GHCR publish** - no separate commit (verification-only task; local static gate passed, no file changes; the definitive real-run verification is performed by the orchestrator after this plan's docs commit, per this quick task's stated constraints: "Do NOT push to the remote — the orchestrator handles pushing and watching the real CI run to verify the new publish job")

**Plan metadata:** commit created separately by the orchestrator (per execution constraints, this executor does not commit docs artifacts).

## Files Created/Modified
- `.github/workflows/ci.yml` - Added the `publish` job (Task 1)
- `docs/DEPLOYMENT.md` - Added Section 6 (GHCR publish/pull flow) + one-sentence pointer in Section 2 (Task 2)

## Decisions Made
- `publish` job kept in the same `ci.yml` file rather than a separate workflow, so `needs: [test, smoke]` can gate directly on CI success (a separate file would require the more fragile `workflow_run` trigger).
- Three-tag scheme (`latest`/`main`/`sha-<short>`) exactly as locked during planning — no `v*`/release tag trigger added (repo has no tag convention).
- GHA layer caching (`cache-from/cache-to: type=gha`) added to the build-push step per plan spec, using the default token — speeds up the pnpm install + workspace build inside the Docker build.

## Deviations from Plan

None - plan executed exactly as written for Tasks 1 and 2.

Task 3's action block calls for pushing to `main` and watching the real workflow run (`gh run watch`) as the "DEFINITIVE verification." This quick task's execution constraints explicitly state: "Do NOT push to the remote — the orchestrator handles pushing and watching the real CI run to verify the new publish job." This executor therefore performed only the local static validation half of Task 3 (YAML parse via `yq`, confirmed `act`/`actionlint` are not installed) and left the real-run verification to the orchestrator, exactly as instructed. This is not a Rule 1-4 deviation — it is following an explicit, higher-priority instruction in this executor's own task constraints, which supersedes the plan's task-internal verification sequencing.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. (The orchestrator will need to push to `main` and watch the triggered workflow run to complete Task 3's definitive verification; this does not require any new secrets — `GITHUB_TOKEN` is automatically available to the `publish` job.)

## Next Phase Readiness
- `ci.yml` and `docs/DEPLOYMENT.md` changes are committed and ready for the orchestrator to push to `main`.
- Once pushed, the orchestrator should confirm via `gh run watch`: `test` → `smoke` → `publish` all green, then verify the GHCR package `zebra-group/zack` exists with `latest`/`main`/`sha-*` tags (`gh api /orgs/zebra-group/packages/container/zack/versions`), and that a `docker pull ghcr.io/zebra-group/zack:latest` succeeds after `docker login ghcr.io`.
- No blockers.

---
*Phase: quick-260724-fmm*
*Completed: 2026-07-24*

## Self-Check: PASSED

- FOUND: .github/workflows/ci.yml
- FOUND: docs/DEPLOYMENT.md
- FOUND: .planning/quick/260724-fmm-add-github-actions-workflow-to-build-and/260724-fmm-SUMMARY.md
- FOUND: 76981fb (Task 1 commit)
- FOUND: a22c687 (Task 2 commit)
