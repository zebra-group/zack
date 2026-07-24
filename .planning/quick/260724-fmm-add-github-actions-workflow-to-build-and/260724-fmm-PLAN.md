---
phase: quick-260724-fmm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .github/workflows/ci.yml
  - docs/DEPLOYMENT.md
autonomous: true
requirements:
  - CI-PUBLISH-01  # Build + publish production Docker image to GHCR on push to main
user_setup: []

must_haves:
  truths:
    - "Pushing a commit to `main` triggers the `publish` job, but only after both `test` and `smoke` succeed."
    - "The `publish` job builds the repo's multi-stage Dockerfile and pushes it to `ghcr.io/zebra-group/zack`."
    - "The image is published with three tags: `latest` (tracks main), `main`, and an immutable `sha-<short>` tag."
    - "Pull requests and non-`main` branch pushes never run the push step (no GHCR credentials granted)."
    - "docs/DEPLOYMENT.md documents pulling the published image as an alternative to building locally."
  artifacts:
    - ".github/workflows/ci.yml (extended with a `publish` job)"
    - "docs/DEPLOYMENT.md (with a GHCR publish/pull section)"
  key_links:
    - "publish `needs: [test, smoke]` gates publishing on CI success"
    - "job-scoped `permissions: { contents: read, packages: write }` + docker/login-action with GITHUB_TOKEN authorizes the GHCR push"
    - "`if: github.event_name == 'push' && github.ref == 'refs/heads/main'` restricts the push to main only"
---

<objective>
Add a `publish` job to `.github/workflows/ci.yml` that builds the production
Docker image (the existing multi-stage `Dockerfile`, the same one
`docker-compose.yml`'s `app` service builds) and pushes it to GitHub Container
Registry at `ghcr.io/zebra-group/zack`, then document the new publish/pull flow
in `docs/DEPLOYMENT.md`.

Purpose: Operators can `docker pull ghcr.io/zebra-group/zack:latest` for
production deploys instead of building the image locally on every host — while
the redirect-critical service still only ships images that passed the full
`test` + `smoke` CI gate.

Output: An extended `ci.yml` with a gated, main-only GHCR publish job; an
updated `docs/DEPLOYMENT.md`; a real green workflow run confirming the image was
pushed.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

@.github/workflows/ci.yml
@Dockerfile
@docker-compose.yml
@docs/DEPLOYMENT.md

# Locked investigation findings (verified 2026-07-24 via `gh api ... /tags`;
# do NOT downgrade to training-knowledge versions):
#   docker/setup-buildx-action  -> current major v4 (v4.2.0 latest)
#   docker/login-action         -> current major v4 (v4.5.0 latest)
#   docker/build-push-action    -> current major v7 (v7.3.0 latest)
#   docker/metadata-action      -> current major v6 (v6.2.0 latest)
#   actions/checkout            -> v7 (already pinned in ci.yml — reuse the same major)
# Repo: zebra-group/zack, default branch `main`, visibility PRIVATE.
# `git tag -l` is EMPTY -> no release/tag convention -> NO `v*` trigger (keep it simple).
# Local tooling: `yq` present (YAML validation); `act`/`actionlint` NOT present
#   -> definitive verification is a real push to main + `gh run watch`.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the GHCR publish job to ci.yml</name>
  <files>.github/workflows/ci.yml</files>
  <action>
    Add a third job named `publish` to the existing `.github/workflows/ci.yml`.
    Do NOT modify the shared `on:` block or the existing `test`/`smoke` jobs
    (except that `publish` references them via `needs:`).

    Decision locked during planning (record briefly in a leading comment above
    the job): the publish job lives in the SAME file rather than a separate
    `docker-publish.yml` because requirement #4 requires gating on CI success via
    the `needs:` pattern, and `needs:` only works between jobs in the same
    workflow — a separate file would require the more fragile `workflow_run`
    trigger (which runs against the default-branch workflow definition and has
    ref/SHA ambiguity). Same-file mirrors the existing `smoke needs: test` shape.

    The `publish` job must have exactly these properties:
    - `needs: [test, smoke]` (inline array form so the whole chain must pass first).
    - `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`
      — this is the primary fork-safety guard (mitigates T-fmm-01): the job is
      skipped on all pull_request events and all non-main branch pushes, so a
      fork PR never reaches a step that could hold GHCR push credentials. (Fork
      `pull_request` runs already get a read-only GITHUB_TOKEN and no secrets;
      the `if` guard is defense-in-depth on top of that.)
    - Job-scoped `permissions:` block with `contents: read` and `packages: write`
      (do NOT rely on repo-default token permissions; requirement #5).
    - `runs-on: ubuntu-latest`.

    Steps, in order, pinning each action to the current major verified above:
    1. `actions/checkout@v7` (reuse the major already pinned in this file).
    2. `docker/setup-buildx-action@v4` — required because the Dockerfile uses
       BuildKit features (`--mount=type=cache` and `# syntax=docker/dockerfile:1.7`).
    3. `docker/login-action@v4` against `registry: ghcr.io`, `username: ${{ github.actor }}`,
       `password: ${{ secrets.GITHUB_TOKEN }}`.
    4. `docker/metadata-action@v6` with `id: meta`, `images: ghcr.io/${{ github.repository }}`
       (evaluates to the already-lowercase `ghcr.io/zebra-group/zack`; metadata-action
       lowercases regardless). `tags:` must produce exactly three tags:
       `type=raw,value=latest,enable={{is_default_branch}}`, `type=ref,event=branch`
       (yields `main`), and `type=sha` (yields immutable `sha-<short>` — this is the
       pinnable tag that mitigates floating-`latest` ambiguity, T-fmm-02).
    5. `docker/build-push-action@v7` with `context: .`, `push: true`,
       `tags: ${{ steps.meta.outputs.tags }}`, `labels: ${{ steps.meta.outputs.labels }}`,
       and GitHub Actions layer caching `cache-from: type=gha` /
       `cache-to: type=gha,mode=max` (works with the default token, materially
       speeds the pnpm install + workspace build). Leave `file`/`target` at their
       defaults — the Dockerfile's final stage is `runtime`, which is exactly the
       production image `docker-compose.yml`'s `app` service builds.

    Do NOT add a `v*` tag trigger, semantic-release tooling, or any change to the
    `smoke`/`test` job bodies. Keep the tag scheme to the three tags above.
  </action>
  <verify>
    <automated>yq '.' .github/workflows/ci.yml >/dev/null && grep -q "docker/setup-buildx-action@v4" .github/workflows/ci.yml && grep -q "docker/login-action@v4" .github/workflows/ci.yml && grep -q "docker/metadata-action@v6" .github/workflows/ci.yml && grep -q "docker/build-push-action@v7" .github/workflows/ci.yml && grep -q "ghcr.io/\${{ github.repository }}" .github/workflows/ci.yml && grep -q "needs: \[test, smoke\]" .github/workflows/ci.yml && grep -q "packages: write" .github/workflows/ci.yml && grep -q "github.ref == 'refs/heads/main'" .github/workflows/ci.yml && grep -q "type=sha" .github/workflows/ci.yml</automated>
  </verify>
  <done>ci.yml parses as valid YAML; a `publish` job exists with `needs: [test, smoke]`, `if` restricting to main pushes, `permissions: packages: write`, and the four docker actions pinned to v4/v4/v6/v7 pushing three tags (latest/main/sha-*) to `ghcr.io/zebra-group/zack`. The existing `test`/`smoke` job bodies and the `on:` block are unchanged.</done>
</task>

<task type="auto">
  <name>Task 2: Document the GHCR publish/pull flow in DEPLOYMENT.md</name>
  <files>docs/DEPLOYMENT.md</files>
  <action>
    Add a new section to `docs/DEPLOYMENT.md` documenting the CI-driven GHCR
    publish flow (required by this project's CLAUDE.md DevOps convention —
    requirement #7). To avoid churning the existing "Section N" cross-references
    (Sections 3/4/5 are referenced by number elsewhere in the file), APPEND the
    new section after the Troubleshooting section as `## 6. Continuous image
    publishing to GHCR`, and add a one-sentence pointer at the end of Section 2
    (Build process) noting operators can pull a prebuilt image instead of
    building locally (see Section 6).

    The new section must cover:
    - WHAT publishes: the `publish` job in `.github/workflows/ci.yml` builds the
      same multi-stage `Dockerfile` (identical to `docker-compose.yml`'s `app`
      build) and pushes to `ghcr.io/zebra-group/zack` on every push to `main`,
      only after the `test` and `smoke` jobs pass. PRs and non-main branches
      never publish.
    - WHICH tags exist: `latest` (always tracks the tip of `main`), `main`
      (branch name), and `sha-<short-git-sha>` (immutable — pin this for
      reproducible/rollback-safe deploys).
    - HOW to pull: `docker pull ghcr.io/zebra-group/zack:latest` (or a pinned
      `ghcr.io/zebra-group/zack:sha-<short>`). Because the repo is PRIVATE, the
      GHCR image inherits PRIVATE visibility (requirement #6) — no extra step is
      needed for the CI push itself, but a human/server pulling must first
      authenticate: `docker login ghcr.io` with a GitHub username and a Personal
      Access Token carrying the `read:packages` scope (the CI `GITHUB_TOKEN` is
      only usable inside the workflow, not for out-of-band pulls). Show the
      `--password-stdin` form.
    - THAT it is an alternative to local builds: operators can now pull the
      prebuilt image for production instead of `docker compose build`. Note
      lightly that to consume it via compose you would set
      `image: ghcr.io/zebra-group/zack:latest` on the `app` service (replacing
      `build: .`), but the committed `docker-compose.yml` intentionally still
      builds locally by default — do not over-specify or rewrite the compose file.
    - THE private-visibility note (requirement #6): GHCR images pushed via
      GITHUB_TOKEN inherit the repository's visibility, so the image is private
      by default, matching the repo — no manual visibility step required.

    Keep it concise and consistent with the existing doc's tone/formatting.
  </action>
  <verify>
    <automated>grep -q "ghcr.io/zebra-group/zack" docs/DEPLOYMENT.md && grep -q "docker pull ghcr.io/zebra-group/zack" docs/DEPLOYMENT.md && grep -qi "read:packages" docs/DEPLOYMENT.md && grep -q "sha-" docs/DEPLOYMENT.md && grep -qi "private" docs/DEPLOYMENT.md</automated>
  </verify>
  <done>docs/DEPLOYMENT.md has a new GHCR section covering: the main-only publish trigger gated on test+smoke, the three published tags, the authenticated `docker pull` flow (private image, `read:packages` PAT), the private-visibility inheritance note, and that pulling is an alternative to local `docker compose build`. Existing section numbering and cross-references remain valid.</done>
</task>

<task type="auto">
  <name>Task 3: Validate the workflow and confirm a real GHCR publish</name>
  <files>.github/workflows/ci.yml, docs/DEPLOYMENT.md</files>
  <action>
    Two-stage verification (a GitHub Actions workflow cannot be fully verified
    locally, so the definitive proof is a real run — this mirrors the established
    project pattern from quick task 260724-ecl of verifying CI changes by pushing
    to main and watching the run).

    (a) LOCAL static validation (hard gate, runs in seconds):
        - Confirm `ci.yml` parses as valid YAML (`yq`).
        - `act`/`actionlint` are NOT installed in this environment; note that if
          `act` (nektos/act) is ever available it could dry-run the workflow, but
          it is optional and not the gate here.

    (b) DEFINITIVE verification (real run): after Tasks 1-2 are committed via the
        normal GSD commit step, push the branch to `main` (`git push origin main`)
        and observe the triggered run with `gh run watch` (or
        `gh run view --log` on the run id). Confirm:
        - the `test` and `smoke` jobs pass, THEN the `publish` job runs (it must
          be present-and-executed, not skipped);
        - the `publish` job's build-push step reports the three pushed tags;
        - the package now exists:
          `gh api /orgs/zebra-group/packages/container/zack/versions --jq '.[0].metadata.container.tags'`
          shows `latest` / `main` / a `sha-*` tag;
        - a pull works after login:
          `echo $CR_PAT | docker login ghcr.io -u <username> --password-stdin`
          then `docker pull ghcr.io/zebra-group/zack:latest`.
        Also sanity-check that a push to a NON-main branch (or a PR) does NOT run
        the publish job — i.e. the `if` guard skips it (the fork-safety mitigation).

    If the real run fails, capture the failing step from `gh run view --log` and
    fix ci.yml before considering the task done.
  </action>
  <verify>
    <automated>yq '.' .github/workflows/ci.yml >/dev/null && echo "YAML valid. DEFINITIVE gate (not <60s, run manually): push to main, 'gh run watch', confirm 'publish' job is green after test+smoke, then 'docker login ghcr.io' + 'docker pull ghcr.io/zebra-group/zack:latest' succeeds and 'gh api /orgs/zebra-group/packages/container/zack/versions' lists latest/main/sha-* tags."</automated>
  </verify>
  <done>ci.yml is valid YAML locally; after push to main, `gh run watch` shows test → smoke → publish all green, the GHCR package `zebra-group/zack` exists with `latest`/`main`/`sha-*` tags, `docker pull ghcr.io/zebra-group/zack:latest` succeeds after `docker login ghcr.io`, and the publish job is confirmed skipped on non-main/PR events.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| fork PR → CI workflow | Untrusted PR code runs in the same `ci.yml`; must never obtain GHCR push credentials |
| CI job → GHCR (ghcr.io) | GITHUB_TOKEN pushes an image; scope must be minimal and job-restricted |
| GHCR image → operator host | Operators pull and run the published image in production |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-fmm-01 | Elevation/Info disclosure | `publish` job in ci.yml | high | mitigate | `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` skips the job on all PRs and non-main pushes; fork `pull_request` runs already receive a read-only GITHUB_TOKEN with no secrets; `permissions: packages: write` is scoped to this one job only. |
| T-fmm-02 | Tampering | floating `latest` tag | medium | mitigate | Also publish an immutable `type=sha` tag (`sha-<short>`) so production deploys can pin a specific, verifiable build rather than a mutable `latest`. |
| T-fmm-03 | Info disclosure | GHCR image visibility | medium | accept | GHCR images pushed via GITHUB_TOKEN inherit the repository's visibility; repo `zebra-group/zack` is PRIVATE, so the image is private by default. Documented in DEPLOYMENT.md; no code change needed. |
| T-fmm-04 | Elevation | over-broad token permissions | low | mitigate | Explicit job-level `permissions: { contents: read, packages: write }` instead of inheriting repo-default token scopes (requirement #5). |
</threat_model>

<verification>
1. `yq '.' .github/workflows/ci.yml >/dev/null` — workflow is valid YAML.
2. Structural greps (Task 1) confirm the publish job shape, pinned action
   majors (v4/v4/v6/v7), main-only `if` guard, `needs: [test, smoke]`,
   `packages: write`, and the three-tag scheme.
3. Docs greps (Task 2) confirm the GHCR section covers image name, authenticated
   pull, `read:packages`, sha tag, and private visibility.
4. DEFINITIVE: push to `main`, `gh run watch` shows test → smoke → publish green;
   `gh api /orgs/zebra-group/packages/container/zack/versions` lists the tags;
   `docker pull ghcr.io/zebra-group/zack:latest` succeeds after `docker login`.
5. Fork-safety: a non-main / PR event does NOT run the publish job.
</verification>

<success_criteria>
- `.github/workflows/ci.yml` has a `publish` job that builds the multi-stage
  Dockerfile and pushes `latest` + `main` + `sha-<short>` to
  `ghcr.io/zebra-group/zack`, gated by `needs: [test, smoke]` and an `if` guard
  restricting execution to push events on `main`, with job-scoped
  `packages: write` permission.
- Existing `test`/`smoke` jobs and the shared `on:` trigger are untouched.
- `docs/DEPLOYMENT.md` documents the publish flow, tags, authenticated private
  pull, and the pull-vs-build-locally alternative.
- A real push to `main` produces a green `publish` job and a pullable image.
</success_criteria>

<output>
Create `.planning/quick/260724-fmm-add-github-actions-workflow-to-build-and/260724-fmm-SUMMARY.md` when done.
</output>
