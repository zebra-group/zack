---
phase: quick-260724-gsf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - .releaserc.json
  - .github/workflows/ci.yml
  - docs/DEPLOYMENT.md
  - pnpm-lock.yaml
autonomous: true
requirements:
  - REL-01  # semantic-release cuts versioned Git tag + GitHub Release from conventional commits on push to main (after test+smoke)
  - REL-02  # GHCR image build/push runs in the SAME release job, gated on a newly-cut release (git tag diff), tagged with the release SemVer (1.2.3/1.2/1) + latest — built-in GITHUB_TOKEN only
  - REL-03  # docs/DEPLOYMENT.md Section 6 rewritten for the release-based flow (versioned pulls, latest mapping, changelog; no PAT needed)

must_haves:
  truths:
    - "Pushing conventional commits (feat/fix/etc.) to `main` runs semantic-release only after `test` and `smoke` both pass, and when there is a releasable change it creates a Git tag + GitHub Release with an auto-generated changelog — with no manual review-PR gate (per REL-01, the user's explicit choice over release-please)."
    - "With no pre-existing Git tags in the repo, semantic-release's first release is `1.0.0` (its documented default first-release version), producing tag `v1.0.0`."
    - "Within the SAME `release` job, immediately after semantic-release runs, the job compares the latest Git tag captured BEFORE releasing against the latest tag AFTER releasing (re-fetching tags first); only when a NEW tag appeared does it build the multi-stage Dockerfile and push `ghcr.io/zebra-group/zack` tagged with the release SemVer (`1.2.3`, `1.2`, `1`) plus `latest` — authenticated with the built-in GITHUB_TOKEN (REL-02)."
    - "The Docker image is NO LONGER built/pushed on every push to `main` — it is only built when semantic-release actually cut a new release this run. A no-op run (e.g. a `docs:`/`chore:` commit with no releasable change) leaves the tag unchanged, so `released` is `false` and NO image is built."
    - "The `@semantic-release/git` commit that writes back `package.json` + `CHANGELOG.md` contains `[skip ci]`, so it does not re-trigger the push-driven CI workflow (native GitHub `[skip ci]` behavior — breaks the loop)."
    - "docs/DEPLOYMENT.md Section 6 describes the release-based flow: how releases are cut automatically from conventional commits, how the image only builds when a new release is cut, how to pull a specific version, how `latest` maps to the newest release, where the changelog lives, and that only the built-in GITHUB_TOKEN is used (no PAT / no extra Actions secret to provision)."
  artifacts:
    - ".releaserc.json (repo root — single release stream for the whole product)"
    - "package.json (root devDependencies: the 7 pinned semantic-release packages)"
    - ".github/workflows/ci.yml (old push-triggered `publish` job replaced by ONE `release` job that runs semantic-release AND, gated on a newly-cut release, builds/pushes the GHCR image)"
    - "docs/DEPLOYMENT.md (Section 6 rewritten for the release-based flow)"
  key_links:
    - "`release` job `needs: [test, smoke]` gates cutting a release on a green build (a release is never cut from a broken build)."
    - "The single `release` job authenticates every step with the built-in `secrets.GITHUB_TOKEN` and holds BOTH `contents/issues/pull-requests: write` (for semantic-release) AND `packages: write` (for the GHCR push) — one job, one token, no PAT."
    - "Release detection: capture `git tag --sort=-v:refname | head -n1` BEFORE running semantic-release and AFTER (re-fetching tags with `git fetch --tags --force` first, since semantic-release pushed the new tag to the remote); a differing/non-empty post tag sets `steps.check.outputs.released=true`. Every docker step is gated `if: steps.check.outputs.released == 'true'`."
    - "`docker/metadata-action` is fed four `type=raw` tag lines built from the version/major/minor computed by the `check` step → `1.2.3` / `1.2` / `1` / `latest` on `ghcr.io/${{ github.repository }}`; GITHUB_TOKEN + `packages: write` authorizes the push."
    - "`.releaserc.json` plugin ORDER: commit-analyzer → release-notes-generator → changelog → npm (npmPublish:false) → git ([skip ci] message) → github."
    - "`@semantic-release/npm` with `npmPublish:false` bumps root package.json `version` only — never publishes to the public npm registry (private pnpm workspace)."
---

<objective>
Replace the current "publish the Docker image on every push to `main`" flow with a
version-based release flow driven by semantic-release — implemented as a SINGLE
`release` job in `ci.yml` (Path B):

1. On every push to `main`, after `test` + `smoke` pass, a new `release` job runs
   semantic-release. It analyzes conventional commits and, when there is a
   releasable change, creates a Git tag + GitHub Release with an auto-generated
   changelog (no manual review-PR gate — the user's explicit choice over
   release-please). First release is `1.0.0`.
2. Immediately after, THE SAME job detects whether a new release was actually cut
   by comparing the latest Git tag before vs. after the semantic-release run, and
   ONLY when a new tag appeared does it build the multi-stage Dockerfile and push
   `ghcr.io/zebra-group/zack` tagged with the release SemVer (`1.2.3` / `1.2` / `1`)
   plus `latest`. The old floating `main` / `sha-<short>` tags are dropped (per
   REL-03, "default to dropping them").

Purpose: Ship reproducible, version-pinnable images tied to real releases instead
of one image per push — while the redirect-critical service still only ships
images built from a versioned release cut off a green `test` + `smoke` build.

Output: `.releaserc.json`, 7 pinned devDependencies, a single `release` job
(semantic-release + tag-diff-gated GHCR build/push) replacing the old `publish` job
in `ci.yml`, and a rewritten DEPLOYMENT.md Section 6. Definitive proof (a real
`v1.0.0` release + a versioned GHCR image) is deferred to the orchestrator (a GitHub
Actions release flow cannot be verified locally — mirrors the 260724-fmm quick
task's constraint).

─────────────────────────────────────────────────────────────────────────────
DESIGN NOTE (Path B — chosen by the user)
─────────────────────────────────────────────────────────────────────────────
The user chose to stay on the built-in GITHUB_TOKEN for the entire flow. There is
therefore NO personal access token, NO extra Actions secret to provision, and NO
separate release-event-triggered workflow file — everything lives in ONE `release`
job in `ci.yml`.

Because a plain `push`-driven job cannot learn from a GitHub event whether a release
happened, the job determines "did a release actually happen this run?" with a plain
git-tag diff (latest tag before vs. after running semantic-release, re-fetching tags
in between) — no extra package (`@semantic-release/exec`) and no third-party action
(`cycjimmy/semantic-release-action`) are introduced. The image build/push is gated
on that `released` flag, so a no-op semantic-release run (e.g. a docs-only commit)
builds nothing. Image tags are built directly from the detected version via
`docker/metadata-action` `type=raw` lines.

The `release` job holds both `contents/issues/pull-requests: write` (for
semantic-release's tag, write-back commit, and issue/PR comments) AND
`packages: write` (for the GHCR push) — all satisfied by the one built-in
GITHUB_TOKEN, so no new trust boundary is introduced. The existing main-only `if`
guard keeps the whole job — token and all — off fork PRs.
─────────────────────────────────────────────────────────────────────────────

Same-file decision (REL-03 #9, decided on genuine cohesion): the `release` job
STAYS in `ci.yml` because it needs `needs: [test, smoke]`, and `needs:` only works
between jobs in the same workflow (same reasoning the 260724-fmm task used for the
old publish job). Under Path B the GHCR publish also stays in this file — it is now
a set of gated steps inside the same `release` job, driven by the push run rather
than a release event, so there is no reason to split it out.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

@.github/workflows/ci.yml
@package.json
@pnpm-workspace.yaml
@docs/DEPLOYMENT.md
@Dockerfile

# Locked investigation findings (verified live 2026-07-24 — do NOT substitute
# training-knowledge versions):
#   semantic-release                        -> 25.0.8
#   @semantic-release/commit-analyzer       -> 13.0.1
#   @semantic-release/release-notes-generator -> 14.1.1
#   @semantic-release/changelog             -> 7.0.0
#   @semantic-release/git                   -> 11.0.1
#   @semantic-release/github                -> 12.0.9
#   @semantic-release/npm                   -> 13.1.5  (npmPublish: false — private workspace, never publish to npm)
# Docker actions (already vetted + in-repo from 260724-fmm — reuse the same majors):
#   docker/setup-buildx-action@v4, docker/login-action@v4,
#   docker/metadata-action@v6, docker/build-push-action@v7, actions/checkout@v7
# Repo: zebra-group/zack (git@github.com:zebra-group/zack.git), default branch main, PRIVATE.
# `git tag -l` is EMPTY -> semantic-release default first release is 1.0.0 (tag v1.0.0).
# Recent commits already use conventional style (feat:/fix:/docs:/chore:/test:).
# Root package.json: private:true, version "0.0.0", pnpm workspace (apps/*, packages/*).
# Local tooling: `yq` present (YAML), Node 24 present (JSON). act/actionlint NOT present
#   -> definitive verification is a real push to main + `gh run watch` (orchestrator).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add semantic-release config and pinned devDependencies</name>
  <files>.releaserc.json, package.json, pnpm-lock.yaml</files>
  <action>
    Add the semantic-release toolchain to the workspace ROOT (one release stream
    for the whole product — do NOT create per-workspace-package configs; REL-03 #5).

    (1) Add the 7 pinned packages as ROOT devDependencies using the pnpm
    workspace-root flag so the lockfile updates:
      `pnpm add -D -w semantic-release@25.0.8 @semantic-release/commit-analyzer@13.0.1 @semantic-release/release-notes-generator@14.1.1 @semantic-release/changelog@7.0.0 @semantic-release/git@11.0.1 @semantic-release/github@12.0.9 @semantic-release/npm@13.1.5`
    Use these EXACT versions (verified live 2026-07-24; REL-03 #4). These are the
    official first-party semantic-release suite (npm org `semantic-release`) — treat
    as operator-approved supply-chain sign-off (T-gsf-SC). They are pure-JS with no
    postinstall build steps, so NO `pnpm-workspace.yaml` `allowBuilds` entry is
    expected. If `pnpm add` reports an ignored build script, do NOT blanket-approve
    it — evaluate per the project's established no-blanket-lifecycle-script rule
    (threat T-01-02) and only add a specific allowBuilds entry if genuinely required.

    (2) Create `.releaserc.json` at the repo root as a JSON object with:
      - `branches`: a single-element array containing `main` (release only from main).
      - `plugins`: an array in EXACTLY this order (order is significant to
        semantic-release):
          1. `@semantic-release/commit-analyzer`
          2. `@semantic-release/release-notes-generator`
          3. `@semantic-release/changelog`  (writes CHANGELOG.md at repo root)
          4. `@semantic-release/npm` configured with option `npmPublish` set to
             false — this keeps root package.json `version` in sync with the
             release tag WITHOUT publishing to the public npm registry (this is a
             private pnpm workspace; REL-03 #4). With npmPublish:false the plugin
             also skips any npm-registry auth check, so NO NPM_TOKEN is needed.
          5. `@semantic-release/git` configured with:
               - `assets`: the two files it commits back — package.json and CHANGELOG.md.
               - `message`: the release commit message. Set it explicitly to
                 `chore(release): ${nextRelease.version} [skip ci]` followed by two
                 newline escapes and `${nextRelease.notes}`. The literal `[skip ci]`
                 is REQUIRED (REL-03 #7): GitHub natively skips push/PR-triggered
                 workflow runs whose head commit message contains it, which prevents
                 this write-back commit from re-triggering ci.yml (loop avoidance).
                 (The plugin's default message already includes `[skip ci]`; we set
                 it explicitly so the loop-avoidance intent is self-documenting and
                 robust against any future default change.)
          6. `@semantic-release/github`  (creates the GitHub Release + Git tag,
             comments on / closes referenced issues + PRs).

    Do NOT configure any prerelease channel, any `tagFormat` override, or any
    per-package config: with no existing tags, semantic-release's documented
    default first release is `1.0.0` and the default `tagFormat` (`v${version}`)
    yields `v1.0.0`. The `release` job (Task 2) strips the leading `v` itself when
    building image tags. Relying on the DOCUMENTED default is correct here — do NOT
    create a `v0.0.0` tag (that would push the first release to the next bump
    instead of 1.0.0).
  </action>
  <verify>
    <automated>node -e "JSON.parse(require('fs').readFileSync('.releaserc.json','utf8'))" && node -e "const p=require('./package.json').devDependencies||{}; const req={'semantic-release':'25.0.8','@semantic-release/commit-analyzer':'13.0.1','@semantic-release/release-notes-generator':'14.1.1','@semantic-release/changelog':'7.0.0','@semantic-release/git':'11.0.1','@semantic-release/github':'12.0.9','@semantic-release/npm':'13.1.5'}; for(const k in req){const v=(p[k]||'').replace(/^[^0-9]*/,''); if(v!==req[k]){throw new Error('missing/wrong '+k+' -> '+(p[k]||'ABSENT'))}} console.log('devDeps OK')" && node -e "const c=require('./.releaserc.json'); const s=JSON.stringify(c); if(!(Array.isArray(c.branches)&&c.branches.includes('main')))throw new Error('branches must include main'); for(const n of ['commit-analyzer','release-notes-generator','changelog','npm','git','github'])if(!s.includes('@semantic-release/'+n))throw new Error('plugin missing: '+n); if(!s.includes('[skip ci]'))throw new Error('git message must contain [skip ci]'); if(!/\"npmPublish\"\s*:\s*false/.test(s))throw new Error('npm plugin must set npmPublish:false'); console.log('releaserc OK')"</automated>
  </verify>
  <done>`.releaserc.json` parses as JSON with `branches:["main"]` and the six plugins in order (commit-analyzer → release-notes-generator → changelog → npm[npmPublish:false] → git[assets + [skip ci] message] → github). Root package.json devDependencies pin all 7 packages at the exact verified versions, and pnpm-lock.yaml is updated. No per-package config, no tagFormat override, no v0.0.0 tag created.</done>
</task>

<task type="auto">
  <name>Task 2: Replace ci.yml publish job with ONE release job (semantic-release + tag-diff-gated GHCR build/push)</name>
  <files>.github/workflows/ci.yml</files>
  <action>
    In `.github/workflows/ci.yml`: DELETE the entire existing `publish` job (the
    push-to-main GHCR build/push, including its `docker/*` steps and its
    `type=raw/type=ref/type=sha` metadata tags). Replace it with a single new
    `release` job that both cuts the release AND (only when a release was actually
    cut) builds/pushes the image. Do NOT touch the shared `on:` block or the `test` /
    `smoke` job bodies in any way (only reference them via `needs:`). No separate
    workflow file is created — everything lives in this one job.

    Define the `release` job with:
    - `needs: [test, smoke]` (inline array — a release is never cut from a broken
      build; REL-03 #9).
    - `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` — release
      only on pushes to main (never on PRs / other branches). This is the fork-safety
      guard: the job's GITHUB_TOKEN (which now carries write scopes) is never reached
      by fork PR code.
    - Job-scoped `permissions:` with `contents: write`, `issues: write`,
      `pull-requests: write` (for @semantic-release/github's tag, write-back commit,
      and issue/PR comments) AND `packages: write` (for the GHCR push in the same
      job). All are satisfied by the built-in GITHUB_TOKEN — REL-03 #6.
    - `runs-on: ubuntu-latest`.

    Steps, in order:
    1. `actions/checkout@v7` with `fetch-depth: 0` (semantic-release REQUIRES full
       history + all tags to compute the next version — the default shallow depth 1
       would break version calculation). Use the DEFAULT checkout credentials so the
       git push performed by `@semantic-release/git` authenticates with the built-in
       GITHUB_TOKEN — do NOT disable the checkout's credential persistence this time.
    2. `pnpm/action-setup@v6` (reuse the major already pinned in this file's `test` job).
    3. `actions/setup-node@v7` with `node-version: 24` and `cache: pnpm` (mirror the
       `test` job's setup).
    4. Install deps: `pnpm install --frozen-lockfile`.
    5. Step named "Capture pre-release tag" with `id: pre` and a single-line
       `run:` of `echo "tag=$(git tag --sort=-v:refname | head -n1)" >> "$GITHUB_OUTPUT"`
       — records the latest existing tag BEFORE releasing (empty string when the repo
       has no tags yet).
    6. Step named "Release" with `run: pnpm exec semantic-release` and an `env:` block
       setting `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` — the built-in token, no
       PAT. semantic-release does NOT need the workspace build/prisma/tests here —
       those already passed in `test` — so keep this step lean (no build step).
    7. Step named "Capture post-release tag" with `id: post`, whose `run:` FIRST
       executes `git fetch --tags --force` (semantic-release pushed the new tag to
       the remote, which the local checkout's refs may not reflect) and THEN
       `echo "tag=$(git tag --sort=-v:refname | head -n1)" >> "$GITHUB_OUTPUT"`.
    8. Step named "Check for new release" with `id: check`, whose `run:` decides
       whether a NEW release was cut this run and, if so, exposes the bare version
       (no leading `v`) plus its major and minor components as step outputs. Logic:
       if `${{ steps.post.outputs.tag }}` is non-empty AND differs from
       `${{ steps.pre.outputs.tag }}`, then write `released=true` to `$GITHUB_OUTPUT`,
       strip the leading `v` from the post tag into a shell `version` var, write
       `version=<value>` to `$GITHUB_OUTPUT`, then split with
       `IFS=. read -r major minor patch <<< "$version"` and write both
       `major=<value>` and `minor=<value>` to `$GITHUB_OUTPUT`; otherwise write only
       `released=false` to `$GITHUB_OUTPUT`. (This is the Path B release detector — a
       no-op semantic-release run, e.g. a docs-only commit, leaves the tag unchanged
       so `released` is `false` and no image is built.)
    9. `docker/setup-buildx-action@v4`, gated `if: steps.check.outputs.released == 'true'`
       (the Dockerfile uses BuildKit features — `--mount=type=cache` and
       `# syntax=docker/dockerfile:1.7`).
    10. `docker/login-action@v4`, gated `if: steps.check.outputs.released == 'true'`,
        against `registry: ghcr.io`, `username: ${{ github.actor }}`,
        `password: ${{ secrets.GITHUB_TOKEN }}`.
    11. `docker/metadata-action@v6` with `id: meta`, gated
        `if: steps.check.outputs.released == 'true'`,
        `images: ghcr.io/${{ github.repository }}` (resolves to
        `ghcr.io/zebra-group/zack`). Feed `tags:` FOUR `type=raw` lines built from the
        `check` outputs (NOT `type=semver` — that expects a release-ref context this
        synthetic push job does not cleanly have):
          `type=raw,value=${{ steps.check.outputs.version }}`                              (e.g. 1.2.3)
          `type=raw,value=${{ steps.check.outputs.major }}.${{ steps.check.outputs.minor }}` (e.g. 1.2)
          `type=raw,value=${{ steps.check.outputs.major }}`                                (e.g. 1)
          `type=raw,value=latest`                                                          (newest release)
        Drop the old `main` / `sha-<short>` floating tags entirely (REL-03 #3 default).
    12. `docker/build-push-action@v7`, gated `if: steps.check.outputs.released == 'true'`,
        with `context: .`, `push: true`, `tags: ${{ steps.meta.outputs.tags }}`,
        `labels: ${{ steps.meta.outputs.labels }}`, and GitHub Actions layer caching
        `cache-from: type=gha` / `cache-to: type=gha,mode=max`. Leave `file`/`target`
        at defaults — the Dockerfile's final `runtime` stage is exactly the production
        image `docker-compose.yml`'s `app` service builds (identical to what the old
        ci.yml publish job built).

    Add a short leading comment above the `release` job recording WHY it lives in
    ci.yml (needs:[test,smoke] gating only works within one workflow) and WHY the
    image build/push is gated on a git-tag diff (a plain push job has no release-event
    context, so the job detects a fresh release by comparing the latest tag before vs.
    after running semantic-release — no PAT, no extra package, no separate workflow).
  </action>
  <verify>
    <automated>yq '.' .github/workflows/ci.yml >/dev/null && test ! -f .github/workflows/release-publish.yml && grep -q 'name: Build, typecheck, and test' .github/workflows/ci.yml && grep -q 'Compose boot & persistence smoke tests' .github/workflows/ci.yml && grep -q 'semantic-release' .github/workflows/ci.yml && grep -q 'needs: \[test, smoke\]' .github/workflows/ci.yml && grep -q 'fetch-depth: 0' .github/workflows/ci.yml && grep -q "github.ref == 'refs/heads/main'" .github/workflows/ci.yml && grep -q 'GITHUB_TOKEN' .github/workflows/ci.yml && grep -Eq 'contents: write' .github/workflows/ci.yml && grep -Eq 'packages: write' .github/workflows/ci.yml && grep -q 'git fetch --tags' .github/workflows/ci.yml && grep -q "steps.check.outputs.released == 'true'" .github/workflows/ci.yml && grep -q 'docker/setup-buildx-action@v4' .github/workflows/ci.yml && grep -q 'docker/login-action@v4' .github/workflows/ci.yml && grep -q 'docker/metadata-action@v6' .github/workflows/ci.yml && grep -q 'docker/build-push-action@v7' .github/workflows/ci.yml && grep -q 'type=raw' .github/workflows/ci.yml && grep -q 'ghcr.io/\${{ github.repository }}' .github/workflows/ci.yml</automated>
  </verify>
  <done>ci.yml parses as valid YAML; the `test` and `smoke` job bodies and the shared `on:` block are unchanged; the old push-triggered `publish` job is gone; NO separate release-publish.yml exists. One `release` job now: `needs: [test, smoke]`, main-only `if`, `permissions` with contents/issues/pull-requests write PLUS packages write, checkout `fetch-depth: 0` (default credentials), a `pnpm exec semantic-release` step authenticated with `secrets.GITHUB_TOKEN`, pre/post tag capture (with `git fetch --tags --force`), a `check` step exporting `released`/`version`/`major`/`minor`, and the four docker steps (buildx v4 / login v4 / metadata v6 / build-push v7) each gated `if: steps.check.outputs.released == 'true'`, emitting four `type=raw` image tags to `ghcr.io/zebra-group/zack`.</done>
</task>

<task type="auto">
  <name>Task 3: Rewrite DEPLOYMENT.md Section 6 and hand off definitive verification</name>
  <files>docs/DEPLOYMENT.md</files>
  <action>
    Rewrite Section 6 of `docs/DEPLOYMENT.md` (currently "Continuous image
    publishing to GHCR", documenting the old push-to-main flow) to describe the new
    release-based flow (required by this project's CLAUDE.md DevOps convention —
    keep DEPLOYMENT.md current; REL-03 #8). Keep it Section 6 (do not renumber —
    Sections 2–5 are cross-referenced by number elsewhere). Retitle it to reflect
    releases (e.g. "6. Versioned releases and GHCR image publishing"). It must cover:

    - HOW releases are cut: semantic-release runs as the `release` job in
      `.github/workflows/ci.yml` on every push to `main`, only after `test` +
      `smoke` pass. It analyzes conventional commits (feat/fix/etc.) and, when there
      is a releasable change, automatically creates a Git tag + GitHub Release with
      an auto-generated changelog — no manual review-PR step. The first release is
      `v1.0.0`.
    - THE TOKEN story: the whole flow uses ONLY the built-in `GITHUB_TOKEN`. State
      plainly that there is NO personal access token (PAT) and NO extra Actions
      secret to provision — both semantic-release (tag, release, write-back commit,
      issue/PR comments) and the GHCR image build/push run in the SAME `release` job
      under the one built-in GITHUB_TOKEN, which the job grants
      `contents/issues/pull-requests: write` plus `packages: write`.
    - WHERE + WHEN the image build happens now: in that SAME `release` job, right
      after semantic-release. The job compares the latest Git tag before vs. after
      running semantic-release; ONLY when a new tag appeared does it build the same
      multi-stage `Dockerfile` and push to `ghcr.io/zebra-group/zack`. The image is
      NO LONGER built on every push to main — a push whose commits produce no
      releasable change (e.g. a docs-only commit) cuts no release, so no image is
      built that run.
    - WHICH tags exist now: SemVer tags `1.2.3` (exact), `1.2` (minor track), `1`
      (major track), and `latest` (newest release). Explicitly state the old
      `main` / `sha-<short>` floating tags are GONE (dropped for simplicity now that
      builds are version-gated).
    - HOW to pull a specific version: `docker pull ghcr.io/zebra-group/zack:1.2.3`
      (or `:1.2`, `:1`, `:latest`). Keep the existing authenticated-pull guidance
      (the repo/image is PRIVATE, so an out-of-band pull needs `docker login ghcr.io`
      with a PAT carrying `read:packages`; the CI GITHUB_TOKEN is only valid inside
      the workflow). Make clear this pull-time `read:packages` PAT is unrelated to the
      release process — the release/publish flow itself needs no PAT.
    - HOW latest maps: `latest` always tracks the newest published release.
    - WHERE the changelog lives: `CHANGELOG.md` at the repo root, auto-generated by
      `@semantic-release/changelog` and committed back to `main` by
      `@semantic-release/git` with a `[skip ci]` commit (which is why that write-back
      does not re-trigger CI).

    Also update the one-sentence pointer at the END of Section 2 (Build process) if
    it references the old push-based publish, so it points to the release-based flow
    in Section 6. Keep the tone/formatting consistent with the rest of the doc.

    Then perform LOCAL static validation only, and hand off the definitive
    verification to the orchestrator (a GitHub Actions release flow cannot be
    verified locally — mirrors the 260724-fmm constraint):
      (a) LOCAL (hard gate, seconds): ci.yml parses as valid YAML (`yq`),
          `.releaserc.json` parses as JSON (`node`). act/actionlint are NOT installed.
      (b) DEFINITIVE (deferred to orchestrator — do NOT push from this executor):
          after these commits land, the orchestrator pushes to `main` and runs
          `gh run watch`, confirming: `test` → `smoke` → `release` all green; a
          `v1.0.0` Git tag + GitHub Release appear with a generated changelog; the
          SAME `release` job's docker steps then run (because `released=true`) and
          push the image; and
          `gh api /orgs/zebra-group/packages/container/zack/versions --jq '.[0].metadata.container.tags'`
          shows `1.0.0` / `1.0` / `1` / `latest`; and `docker pull
          ghcr.io/zebra-group/zack:1.0.0` succeeds after `docker login ghcr.io`. Also
          confirm no image is built on a plain push that produces no release (i.e.
          `released=false` skips the docker steps), and that the `[skip ci]` write-back
          commit does not trigger a second CI run. No PAT prerequisite this time — the
          built-in GITHUB_TOKEN is sufficient.
  </action>
  <verify>
    <automated>grep -q 'ghcr.io/zebra-group/zack:1' docs/DEPLOYMENT.md && grep -q 'GITHUB_TOKEN' docs/DEPLOYMENT.md && grep -q 'CHANGELOG.md' docs/DEPLOYMENT.md && grep -qi 'skip ci' docs/DEPLOYMENT.md && grep -qi 'latest' docs/DEPLOYMENT.md && grep -qi 'read:packages' docs/DEPLOYMENT.md && grep -qi 'release' docs/DEPLOYMENT.md && yq '.' .github/workflows/ci.yml >/dev/null && node -e "JSON.parse(require('fs').readFileSync('.releaserc.json','utf8'))" && echo "LOCAL gate passed. DEFINITIVE gate (deferred to orchestrator, no PAT needed): push to main, 'gh run watch' -> test/smoke/release green -> v1.0.0 release+changelog -> SAME release job pushes ghcr.io/zebra-group/zack:1.0.0/1.0/1/latest; 'docker pull ghcr.io/zebra-group/zack:1.0.0' after 'docker login ghcr.io'."</automated>
  </verify>
  <done>docs/DEPLOYMENT.md Section 6 documents the release-based flow: automatic semantic-release cutting from conventional commits (first release v1.0.0); only the built-in GITHUB_TOKEN is used (no PAT / no extra secret to provision); the image builds/pushes in the SAME release job only when a new release is cut; the new SemVer + latest tags (old main/sha tags noted as dropped); versioned `docker pull` for the private image (pull-time `read:packages` PAT distinguished from the release process); latest→newest-release mapping; and CHANGELOG.md at repo root. ci.yml is valid YAML and `.releaserc.json` is valid JSON locally; the definitive real-run verification is explicitly handed off to the orchestrator with no PAT prerequisite.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| conventional commits on `main` → semantic-release | Commit types drive the version bump; a crafted commit could inflate the version |
| single `release` job (built-in GITHUB_TOKEN) → GitHub API/git + GHCR | One job holds `contents/issues/pull-requests: write` (semantic-release) AND `packages: write` (GHCR push); all via the built-in GITHUB_TOKEN — one token, one job |
| GHCR image → operator host | Operators pull and run the published versioned image in production |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-gsf-02 | Elevation/Tampering | single `release` job holding contents/issues/pull-requests + packages write | medium | mitigate | All write scopes are the built-in GITHUB_TOKEN (no PAT, no new trust boundary — it is the same token whether it authorizes the git tag or the GHCR push), so combining semantic-release and the image push in one job adds no external credential. The job runs only on push to `main` (`if` guard), never on PRs, so fork PR code never reaches the write-scoped token. NOTE: a future contributor might try to trigger this job from a fork PR — the main-only `if` guard prevents that and MUST be retained. |
| T-gsf-03 | DoS (CI loop) | @semantic-release/git write-back commit | medium | mitigate | Explicit `[skip ci]` in the `@semantic-release/git` `message` → GitHub natively skips the push-triggered CI run for that commit, preventing an infinite release loop (REL-03 #7). |
| T-gsf-04 | Info disclosure | GHCR image visibility | low | accept | Image inherits the repo's PRIVATE visibility automatically via the GITHUB_TOKEN push; documented in DEPLOYMENT.md; no config change needed. |
| T-gsf-05 | Tampering | mutable `latest` tag | low | accept | `latest` is intentionally mutable (tracks newest release); operators are directed to pin an exact SemVer tag (`1.2.3`) for reproducible/rollback-safe deploys — the immutable-pin story is preserved by the exact-version tag rather than the old `sha-<short>` tag. |
| T-gsf-SC | Tampering | npm installs (semantic-release suite) | medium | mitigate | The 7 packages are the official first-party `@semantic-release/*` + `semantic-release` core suite; versions pinned and verified live by the operator 2026-07-24 (operator supply-chain sign-off). Pure-JS, no postinstall build scripts → no `pnpm-workspace.yaml` allowBuilds entry; if an ignored-build-script warning appears, evaluate per the no-blanket-lifecycle rule (T-01-02) rather than blanket-approving. |
</threat_model>

<verification>
1. `node -e "JSON.parse(...)"` — `.releaserc.json` is valid JSON with branches:[main]
   and the six plugins in order (Task 1).
2. `yq '.' .github/workflows/ci.yml >/dev/null` — valid YAML; and
   `test ! -f .github/workflows/release-publish.yml` — no separate publish workflow
   exists (everything is in the one `release` job).
3. Structural greps confirm: 7 pinned devDeps (exact versions);
   `[skip ci]` + `npmPublish:false` in .releaserc.json; ci.yml `release` job
   (`needs:[test,smoke]`, main-only `if`, built-in `GITHUB_TOKEN`, `fetch-depth:0`,
   contents/issues/PR write + packages write) with `test`/`smoke` untouched and the
   old publish job removed; the tag-diff detector (`git fetch --tags`,
   `steps.check.outputs.released == 'true'`) gating the four pinned docker actions
   emitting `type=raw` SemVer tags to `ghcr.io/zebra-group/zack`.
4. Docs greps confirm Section 6 covers the SemVer pull, the built-in GITHUB_TOKEN
   (no PAT), CHANGELOG.md, `[skip ci]`, latest, and `read:packages` (pull-time only).
5. DEFINITIVE (deferred to orchestrator; no PAT prerequisite): push to `main` →
   `gh run watch` shows test → smoke → release green → a `v1.0.0` release + changelog
   → the SAME `release` job's docker steps run (because `released=true`) and push
   `ghcr.io/zebra-group/zack:1.0.0/1.0/1/latest`; `docker pull
   ghcr.io/zebra-group/zack:1.0.0` succeeds after `docker login`; a no-release push
   builds no image (`released=false`); and the `[skip ci]` write-back does not spawn
   a second CI run.
</verification>

<success_criteria>
- `.releaserc.json` (root) configures a single release stream: commit-analyzer →
  release-notes-generator → changelog → npm(npmPublish:false) → git([skip ci]) →
  github, on `main`; 7 pinned devDeps present in root package.json + lockfile.
- `ci.yml`'s old push-triggered GHCR publish job is replaced by ONE `release` job
  (needs:[test,smoke], main-only, built-in-GITHUB_TOKEN, fetch-depth:0) that runs
  semantic-release and then — gated on a git-tag diff (`released == 'true'`) — builds
  and pushes the versioned image (`1.2.3`/`1.2`/`1` + `latest`) to
  `ghcr.io/zebra-group/zack`; `test`/`smoke` and the `on:` block are untouched; no
  separate release-publish.yml exists; floating `main`/`sha` tags dropped.
- `docs/DEPLOYMENT.md` Section 6 documents the release-based flow, the built-in
  GITHUB_TOKEN (no PAT to provision), SemVer pulls, latest mapping, and the root
  CHANGELOG.md.
- The image is decoupled from every push and only builds when a new release is
  actually cut; the `[skip ci]` write-back prevents a CI loop.
- Definitive real-run verification is handed off to the orchestrator (no PAT
  prerequisite), consistent with the 260724-fmm quick task's constraint of not
  pushing from the executor.
</success_criteria>

<output>
Create `.planning/quick/260724-gsf-add-semantic-release-automated-semver-re/260724-gsf-SUMMARY.md` when done.
</output>
