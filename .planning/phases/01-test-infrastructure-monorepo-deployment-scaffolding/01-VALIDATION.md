---
phase: 1
slug: test-infrastructure-monorepo-deployment-scaffolding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `01-RESEARCH.md` → `## Validation Architecture`. This phase *builds* the
> test harness itself, so Wave 0 stands up the framework before feature-shaped tests exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.x (`@vitest/coverage-v8`) + `@testcontainers/postgresql` + Mailpit |
| **Config file** | `vitest.config.ts` per app (root workspace config) — none yet, Wave 0 installs |
| **Quick run command** | `pnpm vitest run <path>` (single file/dir, no watch) |
| **Full suite command** | `pnpm -r test` (recursive across `apps/*` + `packages/shared`) |
| **Estimated runtime** | ~TBD — measure at Wave 0 diagnostic; target quick run < 15s |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <changed path>`
- **After every plan wave:** Run `pnpm -r test`
- **Before `/gsd-verify-work`:** Full suite must be green (real Postgres via testcontainers)
- **Max feedback latency:** 60 seconds (quick run); full suite bounded by container startup

---

## Per-Task Verification Map

> Filled during execution as tasks are planned/committed. Every INFRA requirement below
> maps to at least one automated test; the named-volume persistence check (INFRA-03) is a
> Compose-level canary and is documented in Manual-Only until scripted.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-00-01 | 00 | 0 | INFRA-01 | — | testcontainers can start a real Postgres and run a query | integration | `pnpm vitest run <db-diagnostic>` | ❌ W0 | ⬜ pending |
| 1-01-01 | 01 | 1 | INFRA-02 | — | boot aborts (`exit 1`) on missing/invalid required ENV; succeeds on valid ENV | unit | `pnpm vitest run <env-schema>` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | INFRA-01 | — | `packages/shared` builds and is importable by both apps | integration | `pnpm -r build && pnpm vitest run <shared>` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Vitest + `@vitest/coverage-v8` installed and a workspace-level `vitest.config.ts` resolves — no framework exists yet (greenfield)
- [ ] `@testcontainers/postgresql` diagnostic test proves a real Postgres container starts and accepts a query (validates D-09 assumption before committing to per-worker plumbing)
- [ ] Vitest `globalSetup` provides the container connection string to workers via `provide`/`inject`; default to one shared container + per-test transaction rollback
- [ ] Shared fixtures / test DB seed helper for the transaction-rollback pattern
- [ ] Mailpit reachable from `docker-compose.dev.yml` (dev/CI only) for later magic-link E2E

*Greenfield: no existing infrastructure — Wave 0 creates all of the above.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Data survives `docker compose down` → `up` (without `-v`) | INFRA-03 | Requires a full container stop/recreate cycle against a named volume — outside the in-process Vitest harness | 1. `docker compose up -d` 2. write a row 3. `docker compose down` (no `-v`) 4. `docker compose up -d` 5. assert the row is still present. Script as a CI job where possible. |
| `docker compose up` yields a working stack with no manual steps beyond ENV | INFRA-01 | End-to-end Compose smoke, not a unit test | Supply `.env`, run `docker compose up`, assert API health endpoint 200 + migrations applied automatically |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
