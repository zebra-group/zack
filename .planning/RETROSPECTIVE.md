# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-07-23
**Phases:** 10 | **Plans:** 65 | **Tasks:** 143

### What Was Built
- A complete self-hosted URL shortener: multi-domain link shortening with operator-delegated TLS, a security-first redirect engine (expiry → password-gate → bot/OG → 302, no premature target leak), privacy-first internal click analytics with a true zero-rows-when-off guarantee, static + dynamic QR codes with logo overlay and scan tracking, a UTM builder and SSRF-safe custom OG metadata, domain-scoped team management proven by an exhaustive denial suite, and optional least-privilege OIDC/SSO — all pixel-close to the Hi-Fi prototype in light and dark.
- 796 automated tests (540 API against a real-Postgres testcontainers harness + 256 web), workspace `tsc --noEmit` clean, ~37k LOC across a pnpm monorepo.

### What Worked
- **Centralizing authorization in two helpers early (Phase 2).** `requireDomainAccess`/`scopedDomainIds` were built with frozen signatures before any route needed them, so every later Links/QR/Analytics path inherited domain-scoping, and Phase 9's account-admin bypass dropped into those same two functions with zero route edits. The Phase-9 denial suite then proved the whole surface at once.
- **TDD with a real-Postgres harness caught integration-level bugs, not just unit bugs.** The per-test isolation canary (`tx-isolation.test.ts`) is what surfaced the transaction-leak defect below.
- **Adversarial verification on security-critical work.** The least-privilege SSO guarantee and the domain denial suite were driven through the *real* code paths (a hermetic in-process OIDC stub; genuinely-existing foreign resource IDs), not hand-rolled shortcuts — so they prove enforcement, not just assertions.
- **Executors verifying framework APIs against the installed package** (magic-link send method, genericOAuth callback path/config) instead of trusting plan text prevented silent no-ops.

### What Was Inefficient
- **A latent test-harness isolation defect cost a debugging detour in Phase 7.** The shared-DB BEGIN/ROLLBACK wrapper silently leaked rows because Postgres has no nested transactions (an interactive `$transaction`'s COMMIT committed the per-test wrapper). It surfaced as non-deterministic cross-file failures. Root-causing and switching to per-file cloned databases was the right fix but interrupted feature flow.
- **A WSL `/mnt/c` filesystem fault wedged the repo for hours mid-Phase-10**, an environment failure requiring an operator `wsl --shutdown`. Recovery state saved to memory made the restart clean (no work lost), but it stalled the run.
- **The default 5s vitest timeout** produced timeout-shaped failures on the slow `/mnt/c` mount that masqueraded as logic errors until raised to 30s.

### Patterns Established
- **Per-file cloned-DB test isolation** (clone a migrated template DB per test file, truncate between tests) — the standing pattern for this repo; never shared-DB + BEGIN/ROLLBACK.
- **Single-write-path (D-01) for every mutable domain entity** (`lib/links.ts`, `lib/qrCodes.ts`, `lib/team.ts`) with Zod allowlists and server-owned fields marked un-assignable.
- **ENV-everywhere configuration** for a self-hosted product (SMTP, GeoIP, TLS target, brand, and now OIDC) — the deployment's env/secrets file is the operator's configuration surface; the dashboard reflects state rather than storing credentials.
- **Concurrency-safe invariants via `SELECT … FOR UPDATE`**, not a transaction-wrapped `count()` recheck (the last-admin lockout guard).

### Key Lessons
1. Build shared cross-cutting primitives (authorization) with frozen signatures *before* their consumers, and prove them once at the end with an exhaustive negative suite — cheaper and more trustworthy than per-route checks.
2. A test harness's isolation guarantee must itself be tested against the *hard* case (writes through the framework's transaction API), not just a plain write — the easy-case canary hid a real leak.
3. When a framework's preferred API isn't in the installed version (the `sso` plugin), verify what *is* shipped and adapt (`genericOAuth` + `discoveryUrl`) rather than adding a dependency mid-run.
4. Save precise recovery state to durable memory during any long unattended run — it turned a multi-hour environment fault into a zero-loss restart.

### Cost Observations
- Model mix: orchestration on Opus; executors/reviewers/verifiers dispatched on Sonnet.
- Notable: dispatching plan-check + code-review + verify as independent adversarial passes per phase caught real blockers (static-QR scan gap, UTM-lost-on-unlock, env-boot brick, denial-suite false-coverage) that single-pass execution would have shipped.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 10 | 65 | Established the GSD discuss→UI-spec→plan→plan-check→execute→review→verify pipeline with adversarial subagent passes |

### Cumulative Quality

| Milestone | Tests | Harness | Zero-Dep Additions |
|-----------|-------|---------|-------------------|
| v1.0 | 796 (540 API + 256 web) | real-Postgres testcontainers, per-file cloned DB | genericOAuth reused (no new dep for SSO) |

### Top Lessons (Verified Across Milestones)

1. (v1.0) Centralize authorization; prove it with an exhaustive denial suite.
2. (v1.0) Test the test harness's own isolation guarantee against the hard case.
