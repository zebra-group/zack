# Feature Research

**Domain:** E2E test coverage scope for a self-hosted URL-shortener/link-management dashboard (bit.ly/dub.co class) — magic-link + OIDC auth, domain-scoped RBAC, QR codes, privacy-friendly analytics
**Researched:** 2026-07-24
**Confidence:** MEDIUM (synthesis of established Playwright/testing-pyramid practice + general web sources; individual web citations are LOW-confidence blog/community content, but cross-checked against multiple independent sources and general software-testing consensus, and against this project's own already-established TDD/testing conventions in PROJECT.md)

> Milestone note: this file supersedes the v1.0 product-feature-landscape research (originally researched 2026-07-10) for the purposes of the **v1.1 "E2E Test Coverage" milestone**. The v1.0 product features are fully shipped and validated (see PROJECT.md Validated section); this milestone adds no new product features, only test coverage. In this research the "feature" grain is therefore **E2E test scenario groups**, not product features. Table Stakes = scenarios that must exist for "complete E2E coverage" to be a true claim. Differentiators = valuable edge-case scenarios that raise confidence further. Anti-Features = scenarios that look temptingly automatable as E2E but are actively wasteful there and belong in unit/integration tests instead.

## Feature Landscape

### Table Stakes (Users/Stakeholders Expect These)

These are the scenarios a reviewer or auditor would look for first; missing any of them means the "complete E2E coverage" claim in the milestone goal is not actually true.

| Feature (E2E scenario group) | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Auth — Magic-link login round-trip** | Core Value depends on getting past login; this is the only login method (no password fallback) so it is the single point of failure for every other flow. | MEDIUM | Requires an SMTP catcher (Mailpit/MailHog) wired into `docker-compose.dev.yml` + CI, a way to poll it via HTTP API, extract the link, and navigate. Must also cover: invalid/expired magic-link token → rejected; unknown (non-invited) email → no session created (invite-only). |
| **Auth — OIDC/SSO login round-trip** | Explicit v1.0 feature; SSO users get a different provisioning path (least-privilege "Mitglied" on first login) that only an E2E test can prove end-to-end through real cookie/session issuance. | MEDIUM-HIGH | Recommend one real-flow smoke test against a disposable/test IdP (or a stub OIDC provider container) to validate the callback contract, plus mocked/intercepted variants for negative cases (denied consent, invalid state, callback tampering) — don't hand-roll every OIDC edge case against a live IdP. |
| **Auth — Session/logout & route guarding** | Every other E2E scenario depends on a working session; also a security-relevant boundary (unauthenticated access to dashboard routes must redirect to login). | LOW-MEDIUM | Cheap once magic-link login exists — reuse `storageState` from the login test as a fixture for all subsequent suites rather than re-running login per test. |
| **Redirect handler — slug → target (happy path)** | This *is* the Core Value statement in PROJECT.md verbatim ("wenn alles andere ausfällt, muss der Redirect-Handler korrekt funktionieren"). | LOW | Simple GET against the custom domain (or a test domain fixture) → assert 3xx + `Location` header, or full navigation → final URL. |
| **Redirect handler — password gate** | Explicit security constraint: target must never leak pre-auth. | MEDIUM | Must assert (a) wrong password rejected, correct password passes; (b) response body/HTML before password entry contains **no trace** of the real target (a common regression class per research). |
| **Redirect handler — expiry (410) gate** | Explicit v1.0 requirement; distinct HTTP semantics from "not found." | LOW | Assert exact 410 status + that target is not leaked, distinct from a 404 slug-not-found case. |
| **Redirect handler — bot / OG-tag rendering** | Explicit v1.0 feature (custom OG tags, SSRF-safe, no OG preview of the target before unlock) — a security-relevant negative-space feature that's easy to silently regress. | MEDIUM | Simulate a bot UA (or hit the route with the server-side-rendering code path) and assert OG meta tags reflect the *custom* configured title/description/image, not the real target's OG data, and that this respects password/expiry gates too (gated links must not leak OG preview of the real target). |
| **Redirect handler — query-param forwarding & UTM** | Explicit v1.0 feature (UTM builder) whose only observable proof is the final redirected URL. | LOW-MEDIUM | Assert query params configured in the UTM builder appear on the final `Location`/navigated URL, and that request-time query params are forwarded/merged correctly. |
| **Links CRUD — create/edit/delete + search/filter** | Baseline dashboard functionality; if broken, the product is unusable regardless of anything else. | LOW-MEDIUM | One canonical "author a link, see it, edit it, delete it, find it via search" journey covers most of this; don't multiply near-duplicate CRUD tests for password/expiry/OG variants that are already integration-tested. |
| **Links — CSV bulk import (preview → commit)** | Two-step, stateful UI flow (upload → preview → commit) that is exactly the kind of multi-step, cross-request flow E2E exists to validate; integration tests can't exercise the file-upload UI itself. | MEDIUM-HIGH | Cover: valid CSV happy path, preview showing correct row count/diff, partial-failure rows surfaced correctly, and commit only writes what was previewed (no silent extra rows). |
| **QR Studio — static QR generation + customization** | Explicit, highly visual v1.0 feature (color/rounding/logo); visual/interactive state is exactly what E2E (vs. unit) is good at catching. | MEDIUM | Assert the generated PNG/SVG actually decodes back to the target URL after customization (round-trip, not just "an image rendered") — this is the one QR assertion that must be end-to-end, not just visual. |
| **QR Studio — dynamic QR remapping (`/q/:code`)** | Distinct feature from static QR: the *whole point* is that the same physical code can be repointed without reprinting; only a real GET-after-remap proves this works. | MEDIUM | Generate dynamic QR → resolve to target A → remap in Studio → resolve to target B via the same `/q/:code` URL, and assert remap history is recorded. |
| **QR Studio — PNG/SVG export** | Explicit dual-format requirement. | LOW | One test per format is enough; don't multiply across every color/logo permutation (that's a rendering/unit concern). |
| **Analytics — per-link view populates after a tracked click** | Core value-prop differentiator ("privacy-friendly internal tracking"); only an E2E test proves the full pipeline (click → recorded → rendered in UI) actually wires together. | MEDIUM | Perform a real redirect-handler hit, then assert the analytics view reflects it (count, referrer/country if feasible in test env). |
| **Analytics — tracking toggle produces true zero-rows** | Explicit, security/privacy-relevant requirement ("true zero-rows wenn aus") — this is a *negative* assertion that's easy to accidentally break in a refactor and easy to skip in manual QA. | MEDIUM | Toggle tracking off → perform redirect → assert no new tracking row is created (not just "hidden in UI"). Best proven via API/DB assertion, but the toggle-and-click journey belongs in E2E since it spans UI + redirect handler + storage. |
| **Team management — invite → accept → appears in team list** | Only way new users are provisioned (invite-only); this is a genuinely multi-actor, multi-session flow (inviter + invitee) that only E2E can exercise faithfully. | MEDIUM-HIGH | Requires two browser contexts (or sequential context switch) + the SMTP catcher again (invite email reuses magic-link-style delivery). |
| **Team management — role & domain assignment changes take effect** | Explicit v1.0 feature; the "does the change actually restrict/grant access after being saved" question is an E2E-shaped question, not a unit one. | MEDIUM | Admin changes a member's domain scope → member's own session (re-navigated) shows only the newly scoped domains. |
| **Domain-scoped authorization — deny path per resource type** | This is the single most safety-critical claim in the whole project ("serverseitig bei JEDER Operation autorisiert... bewiesen durch Denial-Suite") — already proven at the integration level in v1.0, but the milestone explicitly calls out "domain-scoped Autorisierung end-to-end" as new E2E scope. | HIGH | E2E's job here is *not* to re-enumerate every denial (that's the existing integration Denial-Suite's job) — it's to prove the denial is also correctly surfaced through the real UI/session for at least one resource per type (link, QR, analytics) so a UI-layer regression (e.g. a client-side-only guard silently replacing the server check) would be caught. |
| **Account-admin bypass** | Explicit v1.0 mechanism (account-admin bypasses domain scoping) that is easy to accidentally over- or under-scope. | LOW-MEDIUM | One test: account-admin sees/acts on a domain never explicitly assigned to them. |

### Differentiators (Raise Confidence Further — Nice-to-Have Edge Cases)

Not required for the coverage claim to be true, but valuable if time allows; typically the second wave after table stakes are green.

| Feature (E2E scenario group) | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Magic-link: resend / rate-limit UX** | Proves the rate-limit constraint (`@fastify/rate-limit` on the magic-link request endpoint) surfaces a sane UI message rather than a silent failure. | LOW-MEDIUM | Good candidate for a single test; rate-limit *logic* itself is better unit/integration-tested. |
| **OIDC — first-SSO-login provisioning edge case (existing email collision)** | Verifies SSO-created accounts correctly reconcile with an existing invited-but-not-yet-activated magic-link account for the same email. | MEDIUM-HIGH | Genuinely tricky account-linking logic; worth one dedicated E2E test given it's a known source of real-world auth bugs. |
| **Redirect handler — malformed/unknown slug on a valid domain** | Confirms clean 404 behavior distinct from password (401/403-style) and expiry (410). | LOW | Cheap addition once the other redirect states exist. |
| **Redirect handler — case sensitivity / trailing slash / query-string-only variants of the same slug** | Real-world URL-shortener robustness; users paste links with trailing punctuation, tracking wrappers, etc. | LOW | Good candidate for a small parametrized test, not a full scenario each. |
| **CSV import — large file / duplicate-slug conflict handling** | Import is the riskiest bulk-write path in the product; conflict resolution (skip/overwrite existing slug) is exactly the kind of stateful edge case E2E should protect once. | MEDIUM | One dedicated "conflicting rows in the preview" test is worth it; don't build a matrix of every possible CSV malformation here (push to unit tests on the parser). |
| **QR Studio — logo overlay at max distortion (EC-level H boundary)** | Visual correctness at the edge of scannability. | MEDIUM | The decode-round-trip test (table stakes) already covers correctness; this is about visual regression, better served by a snapshot/visual-diff test than a new full E2E journey. |
| **Analytics — global (cross-link) dashboard view aggregation** | Confirms rollup math, not just per-link. | LOW-MEDIUM | Worth one test once per-link analytics E2E exists — mostly a UI-aggregation smoke check. |
| **Team — member removal revokes access mid-session** | Session-invalidation-on-removal is a real security property, not just a CRUD delete. | MEDIUM | Valuable if the removed-member's active session is expected to be killed immediately rather than only on next login. |
| **Dashboard theming — Light/Dark toggle persists across navigation** | Explicit pixel-fidelity/UX requirement, but purely cosmetic/state-persistence. | LOW | Cheap, but genuinely "nice to have" — a visual-regression tool or a single smoke assertion is enough; don't build a Light+Dark variant of every other E2E scenario (see Anti-Features). |

### Anti-Features (Commonly Tempting to E2E-Automate, Often Wasteful There)

| Feature (scenario) | Why Tempting as E2E | Why Problematic as E2E | Alternative |
|---------|---------------|------------------|-------------|
| **Every input-validation error message (slug format, URL format, password rules, CSV column mismatch, etc.)** | Feels like "real user behavior," and QA instinct is to click through every validation error. | Multiplies test count and runtime for logic that is pure and synchronous — no real integration risk. Slows the suite down without raising confidence proportionally (violates the ~10%-of-suite guidance for E2E). | Unit-test the validators/schemas directly (Fastify schema validation, Vue form validators); E2E only needs one representative "invalid input shows an error" smoke case per form. |
| **Exhaustive domain-scoped denial matrix (every role × every resource × every operation)** | It's the single most safety-critical property in the app, so the instinct is "test everything, everywhere." | This exact matrix is already what the existing v1.0 integration-level "Denial-Suite" (per Key Decisions in PROJECT.md) proves cheaply and fast via `fastify.inject`; re-doing the full matrix through a real browser is slow, redundant, and doesn't test anything the integration suite doesn't already cover. | Keep the integration Denial-Suite as the source of truth for the full matrix; E2E adds only representative UI-layer proof (see Table Stakes) that the server check isn't bypassed by a client-side-only guard. |
| **Full color/rounding/logo permutation matrix in QR Studio** | Visually rich feature invites "test every combination users could configure." | Combinatorial explosion of near-identical journeys testing rendering, not integration; QR generation logic (Reed–Solomon, compositing) is a `qrcode`+`sharp` library concern already covered by unit tests per the stack's testing philosophy. | One E2E decode-round-trip test (already Table Stakes) + optional visual-regression snapshots for style permutations, not full Playwright journeys per combination. |
| **Testing OIDC/IdP's own login page or third-party SSO provider behavior** | "Complete coverage" instinct says test the whole login journey including the IdP screens. | You don't control the IdP's UI; it's flaky, slow, occasionally down, and testing it proves nothing about Kurzly's own code — pure external-dependency risk with no product-quality payoff. | Mock/intercept the OIDC callback for negative/variant cases; keep at most one deep "real flow against a disposable test IdP container" smoke test, not a suite. |
| **Real production SMTP delivery in E2E/CI** | Feels "more real" than a catcher. | Slow, flaky, potential cost, and leaks test emails; also explicitly listed as a project-level anti-pattern already ("Real third-party SMTP providers in CI/E2E tests"). | Mailpit/MailHog catcher, dev/CI only (already decided in the project's stack docs). |
| **Pixel-perfect Light/Dark visual fidelity via Playwright assertions** | UI-treue is an explicit hard constraint, so it's tempting to assert exact colors/spacing per screen via Playwright. | Playwright is the wrong tool for pixel-fidelity verification (brittle screenshot diffs across environments/fonts); this is a UI-review/visual-regression-tool concern, not a functional E2E concern. | Keep Light/Dark to functional smoke coverage (toggle works, persists) in E2E; delegate pixel-fidelity to a dedicated visual-review pass (e.g. this toolchain's `gsd-ui-review` process) or a proper visual-regression tool. |
| **Analytics numeric-precision / referrer-parsing edge cases (unusual user-agents, malformed referrers, IP-to-country edge cases)** | Analytics correctness feels safety-critical, so it's tempting to E2E-test many input variants. | This is data-transformation logic (UA/referrer parsing, GeoIP lookup) with no meaningful browser-interaction component — an E2E test can't easily control the actual referrer/UA reaching the server in a realistic way anyway. | Unit/integration-test the parsing functions directly with a table of inputs; E2E only proves "a real click produces a visible non-zero row" (Table Stakes) and "tracking-off produces true zero rows" (Table Stakes). |

## Feature Dependencies

```
Auth E2E infrastructure (Mailpit/MailHog wiring + storageState fixture)
    └──requires──> Magic-link login E2E (must exist and be green first)
                       └──enables──> Session/logout & route-guarding E2E
                       └──enables──> Team management E2E (invite/accept reuses magic-link delivery + login)
                       └──enables──> Domain-scoped authorization E2E (needs authenticated sessions per role)
                       └──enables──> Links / QR / Analytics E2E (all dashboard actions require a logged-in session)

OIDC/SSO login E2E
    └──independent of──> Magic-link E2E (parallel auth path, but shares session/route-guard assertions)
    └──enables──> SSO-provisioning edge cases (account-linking, least-privilege default role)

Redirect handler E2E (slug→target, password, expiry, bot-OG, query-forwarding)
    └──requires──> Links CRUD E2E only insofar as a link must exist to redirect through
                       (in practice: seed a link via API/fixture, not via the CRUD E2E test itself —
                        avoid chaining full UI flows as setup for other E2E tests)
    └──independent of──> Auth E2E (redirect handler is a public, unauthenticated endpoint)

Links CRUD E2E (create/edit/delete/search + CSV import)
    └──requires──> Auth E2E (dashboard actions require a session)
    └──enables──> QR Studio E2E (QR codes attach to a link)
    └──enables──> Analytics E2E (clicks need a link+redirect to generate data)

QR Studio E2E (static + dynamic/:code remapping)
    └──requires──> Links CRUD E2E fixture (a link or standalone QR target must exist)
    └──requires──> Redirect-handler-equivalent resolution logic for /q/:code (same gate semantics)

Analytics E2E (per-link + global + tracking toggle)
    └──requires──> Redirect handler E2E (a real tracked click is the only realistic data-generation path)
    └──requires──> Links CRUD E2E fixture (a link to view analytics for)

Team management E2E (invite/accept/roles/domain assignment/removal)
    └──requires──> Auth E2E infrastructure (invite delivery reuses the SMTP-catcher pattern; acceptance reuses login)
    └──enables──> Domain-scoped authorization E2E (need a second, differently-scoped user to prove deny-path)

Domain-scoped authorization E2E (deny path per resource type, account-admin bypass)
    └──requires──> Team management E2E (need role/domain-assigned users as fixtures)
    └──requires──> Links / QR / Analytics E2E (needs each resource type to attempt denied operations against)
    └──complements (not duplicates)──> existing v1.0 integration-level Denial-Suite (full matrix stays there)
```

### Dependency Notes

- **Auth infrastructure must land first, in its own phase-or-sub-phase:** the Mailpit/MailHog wiring plus `storageState` fixture pattern is the shared foundation every other suite depends on (either directly for login, or transitively via the fixture). Sequencing anything else before this exists means re-doing login boilerplate per suite, then throwing it away.
- **Redirect handler E2E is intentionally decoupled from full Links-CRUD E2E:** seed the link-under-test via a direct API call/fixture rather than driving the "create a link" UI flow as a setup step for redirect tests — this keeps redirect tests fast and independent, and avoids a single flaky CRUD-UI step cascading failures into an unrelated suite.
- **Team management E2E must exist before (or alongside) Domain-scoped-authorization E2E:** you need at least two real, differently-scoped user fixtures (created via the real invite flow, or seeded directly and only *verified* via UI) before you can meaningfully assert a deny path through the UI layer.
- **Domain-scoped authorization E2E complements, not replaces, the existing integration Denial-Suite:** per Key Decisions in PROJECT.md, the full allow/deny matrix already has integration-level proof from v1.0. The new E2E scope's job is narrower and different — proving the *server* check (not a client-side hide) is what's actually gating the UI for at least one representative case per resource type. Treating this as "redo the whole matrix in Playwright" would be the single biggest source of wasted effort in this milestone.
- **QR Studio's dynamic remap (`/q/:code`) shares gate semantics with the redirect handler** (password/expiry-equivalent behavior may apply depending on v1.0 implementation) — reuse the same assertion helpers/fixtures built for the redirect-handler suite rather than re-deriving them.
- **Analytics E2E is downstream of the redirect handler, not of the dashboard UI alone:** the only trustworthy way to generate a "real click" for the analytics view to display is to actually hit the public redirect endpoint (or navigate through it), not to seed a database row directly — seeding directly would test the UI's rendering of fake data, not the tracking pipeline this feature exists to prove.

## MVP Definition (for this milestone: v1.1 "complete E2E coverage")

### Launch With (v1.1 — all Table Stakes rows above)

Minimum required for the milestone's "complete E2E coverage" claim to be honest:

- [ ] Playwright infra: config, fixtures, Mailpit/MailHog wiring in `docker-compose.dev.yml` + CI — foundational, blocks everything else
- [ ] Magic-link login round-trip (happy + invalid/expired token + non-invited email)
- [ ] OIDC/SSO login round-trip (happy path + least-privilege provisioning)
- [ ] Session/logout/route-guard smoke
- [ ] Redirect handler: happy path, password gate, expiry (410), bot-OG rendering, query/UTM forwarding
- [ ] Links CRUD: create/edit/delete/search-filter journey
- [ ] CSV bulk import: preview → commit round-trip
- [ ] QR Studio: static generation + decode round-trip, dynamic remap via `/q/:code`, PNG/SVG export
- [ ] Analytics: click populates per-link view; tracking-off produces true zero rows
- [ ] Team management: invite → accept → appears in list; role/domain assignment takes effect
- [ ] Domain-scoped authorization: one representative deny-path per resource type (link/QR/analytics) + account-admin bypass

### Add After Validation (nice-to-have hardening, same milestone if time allows)

- [ ] Magic-link resend/rate-limit UX
- [ ] SSO account-linking edge case (existing invited email + first SSO login)
- [ ] Redirect handler: unknown-slug 404, slug normalization (trailing slash/case)
- [ ] CSV import: duplicate-slug conflict handling
- [ ] Analytics: global/cross-link aggregation view
- [ ] Team: member removal revokes an active session mid-flight

### Future Consideration (explicitly out of E2E scope, use other test layers instead)

- [ ] Exhaustive validation-message coverage across all forms — unit-test instead
- [ ] Full domain-scoped denial matrix (every role × resource × op) — already covered by the v1.0 integration Denial-Suite
- [ ] Full QR style/color/logo permutation matrix — unit-test the generation library usage + optional visual-regression snapshots
- [ ] Pixel-fidelity Light/Dark verification — visual-review process, not Playwright assertions
- [ ] Analytics UA/referrer/GeoIP parsing edge cases — unit-test the parsing functions

## Feature Prioritization Matrix

| Feature (scenario group) | User/Stakeholder Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Playwright infra + Mailpit/MailHog wiring | HIGH (blocks all else) | MEDIUM | P1 |
| Magic-link login E2E | HIGH | MEDIUM | P1 |
| OIDC/SSO login E2E | HIGH | MEDIUM-HIGH | P1 |
| Redirect handler E2E (all gates) | HIGH (Core Value) | MEDIUM | P1 |
| Links CRUD + CSV import E2E | HIGH | MEDIUM-HIGH | P1 |
| QR Studio E2E (static/dynamic/export) | HIGH | MEDIUM | P1 |
| Analytics E2E (click + toggle) | HIGH | MEDIUM | P1 |
| Team management E2E | HIGH | MEDIUM-HIGH | P1 |
| Domain-scoped authorization E2E (representative) | HIGH (safety-critical) | HIGH | P1 |
| SSO account-linking edge case | MEDIUM | MEDIUM-HIGH | P2 |
| CSV duplicate-slug conflict E2E | MEDIUM | MEDIUM | P2 |
| Analytics global aggregation view | LOW-MEDIUM | LOW-MEDIUM | P2 |
| Team removal mid-session revocation | MEDIUM | MEDIUM | P2 |
| Full denial matrix in E2E | LOW (redundant with integration suite) | HIGH | P3 (avoid) |
| Full QR style permutation matrix | LOW | HIGH | P3 (avoid) |
| Pixel-fidelity Playwright assertions | LOW (wrong tool) | HIGH | P3 (avoid) |

**Priority key:**
- P1: Must have for the "complete E2E coverage" claim in this milestone
- P2: Should have, add once P1 is green and stable
- P3: Anti-pattern for E2E specifically — do not build in Playwright; covered elsewhere or explicitly redundant

## Competitor/Reference Analysis

| Practice | Typical SaaS/dashboard E2E convention | Kurzly's approach |
|---------|--------------|--------------|
| Auth testing under CI | Mock/intercept third-party IdP responses; cache session state via storage-state fixtures rather than re-running login per test | Same — magic-link via real local SMTP catcher (already decided project-wide), OIDC via intercepted callback + one real smoke test against a disposable IdP |
| Multi-tenant/role coverage | Prove critical-path allow/deny per role, not an exhaustive matrix, at the E2E layer; push exhaustive matrices to lower/faster test layers | Same — E2E adds representative UI-layer proof only; full matrix already lives in v1.0's integration Denial-Suite |
| Test pyramid shape | E2E ~10% of suite, reserved for cross-system golden paths; unit/integration absorb the rest | Consistent with the project's existing TDD constraint (Unit + Integration mandatory, E2E for "kritische Flows" only per PROJECT.md) |
| Visual/pixel fidelity | Handled by dedicated visual-regression tooling, not general E2E frameworks | Recommend keeping pixel-fidelity checks out of the Playwright suite; already has a separate `gsd-ui-review` process available in this toolchain |

## Sources

- [Integration testing Passwordless authentication with Playwright — Marcin Skrzyński](https://marcin.codes/posts/integration-testing-passwordless-authentication-with-playwright/) — LOW confidence (community blog, not cross-verified against official docs), consistent with general practice
- [E2E Testing Signup and Login Workflows with Playwright — Better Stack Community](https://betterstack.com/community/guides/testing/playwright-signup-login/) — LOW confidence
- [Test OAuth & SSO in CI: Playwright Examples — Zerocheck](https://tryzerocheck.com/guides/test-oauth-sso/) — LOW confidence
- [How to Manage Authentication in Playwright — Checkly Docs](https://www.checklyhq.com/docs/learn/playwright/authentication/) — LOW confidence (vendor docs, generally reliable for Playwright patterns specifically)
- [Testing Authentication with Playwright: The Complete Guide — Currents.dev](https://currents.dev/posts/testing-authentication-with-playwright-the-complete-guide) — LOW confidence
- [Scaling E2E Tests for Multi-Tenant SaaS with Playwright — CyberArk Engineering (Medium)](https://medium.com/cyberark-engineering/scaling-e2e-tests-for-multi-tenant-saas-with-playwright-c85f50e6c2ae) — LOW confidence, but consistent with independent sources
- [E2E test coverage: how much is enough for your SaaS? — AI QA Live Sessions](https://aiqalive.com/blog/e2e-test-coverage-guide) — LOW confidence
- [The Layers of the Testing Pyramid — Checkly Docs](https://www.checklyhq.com/docs/learn/playwright/testing-pyramid/) — LOW confidence, matches well-established test-pyramid consensus
- [Unit vs Integration vs E2E Testing: Testing Pyramid Decision Framework — Autonoma](https://getautonoma.com/blog/unit-vs-integration-vs-e2e-testing) — LOW confidence
- [Design a URL Shortener Like Bitly — Hello Interview System Design](https://www.hellointerview.com/learn/system-design/problem-breakdowns/bitly) — LOW confidence, general system-design reference for redirect-handler response semantics
- Project-internal: `.planning/PROJECT.md` (v1.0 Key Decisions — existing integration Denial-Suite, testcontainers Postgres harness, TDD constraint) — HIGH confidence (first-party project record)
- Superseded (product-feature-landscape research, retained in git history): `.planning/research/FEATURES.md` as of 2026-07-10 milestone (v1.0 product scope)

---
*Feature research for: E2E test coverage milestone (v1.1), Kurzly self-hosted URL shortener*
*Researched: 2026-07-24*
