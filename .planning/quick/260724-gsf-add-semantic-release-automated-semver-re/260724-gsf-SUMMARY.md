---
phase: quick-260724-gsf
plan: 01
subsystem: infra
tags: [semantic-release, github-actions, ghcr, docker, ci-cd, conventional-commits]

# Dependency graph
requires:
  - phase: quick-260724-fmm
    provides: The original push-triggered `publish` job in ci.yml (docker/setup-buildx-action@v4, docker/login-action@v4, docker/metadata-action@v6, docker/build-push-action@v7, actions/checkout@v7 majors already vetted and in-repo)
provides:
  - Automated SemVer release cutting via semantic-release, driven by conventional commits on `main`
  - A single `release` job in ci.yml that cuts the release AND (gated on a git-tag diff) builds/pushes the versioned GHCR image, all under the built-in GITHUB_TOKEN
  - Rewritten DEPLOYMENT.md Section 6 documenting the release-based publish flow
affects: [ci-cd, deployment-docs, future-phases-touching-ci.yml-or-release-flow]

# Tech tracking
tech-stack:
  added: [semantic-release@25.0.8, "@semantic-release/commit-analyzer@13.0.1", "@semantic-release/release-notes-generator@14.1.1", "@semantic-release/changelog@7.0.0", "@semantic-release/git@11.0.1", "@semantic-release/github@12.0.9", "@semantic-release/npm@13.1.5"]
  patterns:
    - "Single-workflow-file release job (Path B): semantic-release + GHCR publish share one job in ci.yml because needs:[test,smoke] gating only works within one workflow"
    - "Tag-diff release detection: capture latest git tag before/after running semantic-release (re-fetching tags in between) to derive a released=true/false step output, since a plain push job has no release-event context"
    - "Image tags built from step outputs via docker/metadata-action type=raw lines (not type=semver), since this synthetic push-driven job has no release-ref context"

key-files:
  created:
    - .releaserc.json
  modified:
    - package.json
    - pnpm-lock.yaml
    - pnpm-workspace.yaml
    - .github/workflows/ci.yml
    - docs/DEPLOYMENT.md

key-decisions:
  - "Path B (user's explicit choice): no PAT, no separate release-publish.yml — everything lives in one release job in ci.yml, authenticated solely by the built-in GITHUB_TOKEN"
  - "Release detection via plain git-tag diff (before/after semantic-release, re-fetching tags) rather than @semantic-release/exec or a third-party action — avoids adding any new package or trust boundary"
  - "Old floating main / sha-<short> image tags dropped entirely; images are now only tagged with SemVer (1.2.3/1.2/1) + latest, gated on an actual release having been cut"

patterns-established:
  - "release job permissions: contents/issues/pull-requests write (semantic-release) + packages write (GHCR push), all via one GITHUB_TOKEN, gated by the pre-existing main-only push if guard"
  - "@semantic-release/git write-back commit message explicitly includes [skip ci] to prevent a CI-triggered release loop"

requirements-completed: [REL-01, REL-02, REL-03]

coverage:
  - id: D1
    description: "semantic-release cuts a versioned Git tag + GitHub Release from conventional commits on push to main, gated on test+smoke passing (REL-01)"
    requirement: "REL-01"
    verification:
      - kind: other
        ref: ".releaserc.json JSON validation + plugin-order/branches structural grep (node -e JSON.parse ...)"
        status: pass
      - kind: manual_procedural
        ref: "Real push to main + gh run watch confirming v1.0.0 tag/release/changelog appear"
        status: unknown
    human_judgment: true
    rationale: "A GitHub Actions release flow (a real git tag + GitHub Release actually being cut) cannot be verified locally — the orchestrator must push to main and watch the real CI run, per this plan's explicit hand-off."
  - id: D2
    description: "Same release job builds/pushes the GHCR image tagged with SemVer + latest, gated on a git-tag diff detecting a newly-cut release (REL-02)"
    requirement: "REL-02"
    verification:
      - kind: other
        ref: "yq/grep structural verification of ci.yml (release job needs/permissions/steps/gating) — all passed locally"
        status: pass
      - kind: manual_procedural
        ref: "Real push to main + gh run watch confirming release job's docker steps run only when released=true and the GHCR image receives 1.0.0/1.0/1/latest tags"
        status: unknown
    human_judgment: true
    rationale: "Whether the tag-diff gate correctly fires (and does NOT fire on a no-op commit) and whether the GHCR push actually succeeds can only be proven by a real CI run, deferred to the orchestrator per this plan's explicit constraint against pushing from the executor."
  - id: D3
    description: "docs/DEPLOYMENT.md Section 6 rewritten for the release-based flow (versioned pulls, latest mapping, changelog location, no-PAT token story) (REL-03)"
    requirement: "REL-03"
    verification:
      - kind: other
        ref: "grep -qi checks for ghcr.io/zebra-group/zack:1, GITHUB_TOKEN, CHANGELOG.md, skip ci, latest, read:packages, release — all passed"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-24
status: complete
---

# Quick Task 260724-gsf: Automated SemVer Release via semantic-release Summary

**Replaced the push-per-commit GHCR publish flow with a single tag-diff-gated `release` job in ci.yml that runs semantic-release (conventional-commits-driven SemVer + GitHub Release) and only then builds/pushes the versioned image — all under the built-in GITHUB_TOKEN, no PAT.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-24T[see git log timestamps]
- **Tasks:** 3/3
- **Files modified:** 6 (`.releaserc.json` created; `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`, `docs/DEPLOYMENT.md` modified)

## Accomplishments

- Added `.releaserc.json` (root, single release stream) with the required plugin order: commit-analyzer → release-notes-generator → changelog → npm(`npmPublish:false`) → git(`[skip ci]` message) → github, plus the 7 pinned `semantic-release`/`@semantic-release/*` devDependencies at operator-verified exact versions.
- Deleted the old push-triggered `publish` job in `.github/workflows/ci.yml` and replaced it with a single `release` job (`needs: [test, smoke]`, main-only `if`) that runs `pnpm exec semantic-release`, detects whether a release was actually cut via a git-tag diff (capture before, `git fetch --tags --force` + capture after), and — only when `released == 'true'` — builds and pushes the multi-stage Dockerfile image to `ghcr.io/zebra-group/zack` tagged `1.2.3`/`1.2`/`1`/`latest` via `docker/metadata-action` `type=raw` lines. Everything authenticates with the built-in `GITHUB_TOKEN` (job permissions: `contents`/`issues`/`pull-requests: write` + `packages: write`). The `test`/`smoke` job bodies and the shared `on:` block were left untouched; no separate `release-publish.yml` file was created.
- Rewrote `docs/DEPLOYMENT.md` Section 6 ("Versioned releases and GHCR image publishing") to document: how releases are cut (semantic-release on conventional commits, first release `v1.0.0`), the no-PAT/built-in-GITHUB_TOKEN-only token story, where/when the image now builds (same job, gated on the tag diff, no longer on every push), the new SemVer + `latest` tags (old `main`/`sha-<short>` tags noted as dropped), how to pull a specific version, the distinction between the release process (no PAT) and an out-of-band pull (still needs a `read:packages` PAT), and where `CHANGELOG.md` lives. Also updated the Section 2 end-of-section pointer to reference "a prebuilt versioned image."

## Task Commits

Each task was committed atomically:

1. **Task 1: Add semantic-release config and pinned devDependencies** - `eddd04e` (feat)
2. **Task 2: Replace ci.yml publish job with ONE release job** - `ffc3f26` (feat)
3. **Task 3: Rewrite DEPLOYMENT.md Section 6** - `eeb6362` (docs)

**Plan metadata:** committed separately by the orchestrator (per this plan's constraints, this executor did not commit docs/state artifacts).

## Files Created/Modified

- `.releaserc.json` - New: single release stream config (branches:[main], 6-plugin pipeline in required order)
- `package.json` - Added 7 pinned `semantic-release`/`@semantic-release/*` devDependencies (root workspace)
- `pnpm-lock.yaml` - Updated lockfile for the new devDependencies
- `pnpm-workspace.yaml` - `pnpm add` auto-added a `minimumReleaseAgeExclude` entry for `@semantic-release/git@11.0.1` (supply-chain policy exclusion, not a build-script approval)
- `.github/workflows/ci.yml` - Old `publish` job replaced by a single `release` job (semantic-release + tag-diff-gated GHCR build/push)
- `docs/DEPLOYMENT.md` - Section 6 rewritten for the release-based flow; Section 2 pointer updated

## Decisions Made

- Path B (user's explicit prior choice, encoded in the plan): stayed entirely on the built-in `GITHUB_TOKEN` — no PAT, no extra Actions secret, no separate release-triggered workflow file. Everything lives in one `release` job in `ci.yml`.
- Release-cut detection implemented as a plain git-tag diff (capture latest tag before running semantic-release, `git fetch --tags --force` then capture again, compare) rather than `@semantic-release/exec` or a third-party action — avoids introducing any new package or trust boundary, per the plan's explicit design note.
- Image tags built via `docker/metadata-action` `type=raw` lines fed from the `check` step's `version`/`major`/`minor` outputs, not `type=semver` — this synthetic push-driven job has no clean release-ref context for `type=semver` to key off.
- Old floating `main` / `sha-<short>` image tags dropped entirely (per REL-03's "default to dropping them" and the plan's explicit instruction) — the exact-SemVer tag now serves the reproducible/rollback-safe-pin role those tags used to.

## Deviations from Plan

None - plan executed exactly as written. One incidental, expected side effect: `pnpm add -D -w` for the 7 pinned packages auto-added a `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml` for `@semantic-release/git@11.0.1` (a pnpm supply-chain policy exclusion for a recently-published package version, not a build-script approval). This file was not in the plan's `files_modified` list but the change was purely a pnpm-driven side effect of installing the exact pinned version the plan required; it was committed alongside Task 1 and documented here rather than treated as a silent, undocumented diff.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The flow requires zero new secrets: only the built-in `GITHUB_TOKEN` is used end-to-end.

## Next Phase Readiness

- `.releaserc.json`, the pinned devDependencies, and the single `release` job in `ci.yml` are all in place and pass every local validation gate (JSON/YAML parsing, structural greps for job shape, permissions, gating logic, and docker tag construction).
- **Deferred to the orchestrator (per this plan's explicit constraint):** a real push to `main` + `gh run watch` to confirm the definitive, live-only behaviors that cannot be verified from this sandbox:
  - `test` → `smoke` → `release` all run green in sequence.
  - semantic-release actually cuts a `v1.0.0` tag + GitHub Release with a generated changelog (no pre-existing tags in the repo, so this should be the documented first-release default).
  - The SAME `release` job's docker steps then run (because `released=true`) and push `ghcr.io/zebra-group/zack` tagged `1.0.0`/`1.0`/`1`/`latest`.
  - `gh api /orgs/zebra-group/packages/container/zack/versions --jq '.[0].metadata.container.tags'` shows those four tags, and `docker pull ghcr.io/zebra-group/zack:1.0.0` succeeds after `docker login ghcr.io`.
  - A subsequent no-op push (e.g. a `docs:`/`chore:`-only commit) leaves `released=false` and builds no image.
  - The `@semantic-release/git` write-back commit's `[skip ci]` message does not spawn a second CI run (loop-avoidance).
- No blockers identified for that follow-up verification — no PAT prerequisite this time (a difference from the 260724-fmm quick task, which needed a PAT before its equivalent orchestrator hand-off).

## Self-Check: PASSED

All created/modified files confirmed present on disk (`.releaserc.json`, `.github/workflows/ci.yml`, `docs/DEPLOYMENT.md`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`). All 3 task commit hashes (`eddd04e`, `ffc3f26`, `eeb6362`) confirmed present in `git log --oneline --all`.

---
*Phase: quick-260724-gsf*
*Completed: 2026-07-24*
