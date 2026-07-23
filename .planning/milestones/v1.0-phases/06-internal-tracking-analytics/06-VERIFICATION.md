---
phase: 06-internal-tracking-analytics
verified: 2026-07-20T10:50:00Z
status: passed
score: 8/8 must-have groups verified
behavior_unverified: 0
overrides_applied: 0
re_verification: # No previous VERIFICATION.md existed — initial verification
human_verification: # Already completed this session — see 06-UAT.md (11/11 passed)
  evidence: ".planning/phases/06-internal-tracking-analytics/06-UAT.md — all 11 checkpoints passed, incl. cold-start smoke and both pixel-fidelity UI checkpoints (Surface A, C1/C2)"
---

# Phase 06: Internal Tracking & Analytics Verification Report

**Phase Goal:** Users get privacy-first, internal click analytics per link and account-wide — with tracking turned off for a link producing a true zero-rows-written guarantee, never a display-only filter, and no third-party service ever called.
**Verified:** 2026-07-20T10:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Tracking-OFF link writes literally zero ClickEvent rows (structural early-return, not a display filter) — TRACK-02 | ✓ VERIFIED | `redirect.ts:91` `if (!link.trackingEnabled) return;` sits BEFORE any Prisma call in `recordClickHook`. Test `redirect-tracking.integration.test.ts:69,93` redirects a tracking-off link N times and asserts direct DB `count === 0`. All 52 API tests pass. |
| 2 | Bot / expired / password-locked requests never reach the write seam | ✓ VERIFIED | In `redirect.ts` the bot/expired/protected branches return before `recordClickHook` (lines 165-180 precede call at 186). Tests assert `count === 0` for bot (204), expired (227), locked (251). |
| 3 | Tracking-ON records exactly one ClickEvent per 302 with country/referrerHost/visitorHash/source, atomic lifetimeClicks increment | ✓ VERIFIED | `redirect.ts:99-107` single `$transaction([clickEvent.create, link.update{increment}])`. Test asserts event fields + counter. |
| 4 | A tracking write failure never breaks the redirect (302 still fires) | ✓ VERIFIED | Whole hook body wrapped in try/catch (`redirect.ts:93-111`), error logged and swallowed. |
| 5 | No third-party service ever called — referrer/visitorHash/geoip are local-only transforms (TRACK-03) | ✓ VERIFIED | Grep confirms zero fetch/axios/http/undici imports in `geoip.ts`, `referrer.ts`, `visitorHash.ts` (only comments mention it). geoip = local `maxmind.open()` .mmdb read; referrer = WHATWG URL host; visitorHash = node:crypto HMAC. Tests (geoip/referrer/visitorHash) pass. |
| 6 | Raw IP / User-Agent never persisted — only HMAC visitorHash + referrer host leave the helpers; salt rotates daily | ✓ VERIFIED | `visitorHash.ts:38` HMAC-SHA256 digest only; `resolveDailySalt` one 32-byte salt per UTC day, race-safe via `findUniqueOrThrow` fallback. ClickEvent schema has no ip/ua column. |
| 7 | Per-link + global analytics: 30 zero-filled buckets, top referrers/countries, unique visitors, active links, QR=0 (TRACK-04/05) | ✓ VERIFIED | `analytics.ts` generate_series LEFT JOIN 30-bucket series; totalClicks from lifetimeClicks (prune-resistant); uniqueVisitors COUNT DISTINCT visitorHash; qrScans read live as COUNT(source='qr'). Test suite passes 52/52. |
| 8 | IDOR + domain-scoping: /api/links/:id/analytics returns identical 404 for not-found and out-of-scope; /api/analytics domain-scoped; all SQL parameterized (TRACK-04/05) | ✓ VERIFIED | `analytics.ts` route `resolveOwnedLink` runs `scopedDomainIds` first, `findFirst({id, domainId in scope})` → null → `404 {error:"Not found"}` for both cases. Test `analytics.test.ts:314,334-335` asserts forbidden and nonexistent both 404. Global scoped to `scopedDomainIds`; empty-scope short-circuit (no cross-tenant leak, test:258). Every query is tagged `Prisma.sql`; grep confirms NO `$queryRawUnsafe`/interpolation in app code. |

**Score:** 8/8 must-have groups verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/api/src/routes/redirect.ts` | recordClickHook with structural zero-rows guard | ✓ VERIFIED | Guard at line 91; single clickEvent.create call site; atomic transaction |
| `apps/api/src/lib/geoip.ts` | Local .mmdb reader, never throws | ✓ VERIFIED | Lazy singleton, `.catch(()=>null)`, no network I/O |
| `apps/api/src/lib/referrer.ts` | normalizeReferrer host-only | ✓ VERIFIED | WHATWG URL, null on malformed |
| `apps/api/src/lib/visitorHash.ts` | HMAC + daily salt | ✓ VERIFIED | HMAC-SHA256, race-safe salt |
| `apps/api/src/lib/analytics.ts` | Parameterized aggregation | ✓ VERIFIED | All Prisma.sql, no unsafe |
| `apps/api/src/routes/analytics.ts` | IDOR-guarded routes | ✓ VERIFIED | resolveOwnedLink, scopedDomainIds, 401/404 |
| `apps/api/src/lib/retention.ts` | prune functions | ✓ VERIFIED | Wired into server.ts scheduler |
| `apps/api/prisma/schema.prisma` | Link.trackingEnabled/lifetimeClicks, ClickEvent, ScanSource, DailySalt | ✓ VERIFIED | All models present with correct defaults |
| `apps/web/src/views/AnalyticsView.vue` | Global overview (Surface B) | ✓ VERIFIED | Wired to /analytics route; UAT §11 passed |
| `apps/web/src/views/LinkDetailView.vue` | Tracking card + 4-state analytics | ✓ VERIFIED | UAT §2/§10 passed |
| `apps/web/src/components/LinkFormModal.vue` | Footer tracking toggle | ✓ VERIFIED | UAT §3/§9 passed |
| `apps/web/src/views/LinksView.vue` | Klicks column + Tracking-aus badge | ✓ VERIFIED | UAT §3/§9 passed |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| redirect.ts recordClickHook | prisma.clickEvent.create | ONLY call site in codebase | ✓ WIRED |
| lifetimeClicks increment | prisma.link.update | second intentional update site, counter-only, atomic w/ insert | ✓ WIRED |
| analyticsRoute | app.ts | `app.register(analyticsRoute(prisma, auth))` line 160 | ✓ WIRED |
| retention prune | server.ts | pruneClickEvents/pruneDailySalts scheduled at boot | ✓ WIRED |
| /analytics | AnalyticsView | router/index.ts:70 (no longer ComingSoonView) | ✓ WIRED |
| trackingEnabled | createLink/updateLink | Zod allowlist in routes/links.ts (create+update) | ✓ WIRED |

### Prohibitions (must-NOT) verification

| Prohibition | Status | Evidence |
| --- | --- | --- |
| Zero-rows is a structural early-return, not a display filter (TRACK-02) | ✓ VERIFIED | `redirect.ts:91` returns before any Prisma call; DB row-count tests confirm 0 |
| No fetch/HTTP client in geoip/referrer/visitorHash (TRACK-03) | ✓ VERIFIED | Grep: no network imports in any of the three |
| lifetimeClicks NEVER client-settable (mass-assignment T-06-MASS) | ✓ VERIFIED | Absent from both create and update Zod schemas; server-owned |
| No $queryRawUnsafe / string-interpolated SQL (ASVS V5) | ✓ VERIFIED | Grep: only generated-client internals + a NEVER comment; all app queries Prisma.sql |
| No second clickEvent.create call site | ✓ VERIFIED | Grep: single site in redirect.ts |
| source always 'link' this phase (no 'qr' written) | ✓ VERIFIED | recordClickHook hardcodes source:"link"; qrScans read live as 0 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase 6 API test suite | `pnpm vitest run` (6 files: referrer, visitorHash, geoip, analytics, retention, redirect-tracking) | 6 files / 52 tests passed | ✓ PASS |
| Zero-rows on tracking-off | redirect-tracking.integration.test.ts | count === 0 for off/bot/expired/locked | ✓ PASS |
| IDOR no-existence-oracle | analytics.test.ts | forbidden & nonexistent both 404 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
| --- | --- | --- | --- |
| TRACK-01 (toggle tracking per link, default on) | 06-02, 06-06, 06-07 | ✓ SATISFIED | schema default true, Zod allowlist, form toggle + detail card (UAT §5/§9/§10) |
| TRACK-02 (tracking off → zero rows) | 06-04 | ✓ SATISFIED | structural guard + row-count tests |
| TRACK-03 (referrer/country without third parties) | 06-01, 06-03, 06-04 | ✓ SATISFIED | local helpers, no network, HMAC visitor hash |
| TRACK-04 (per-link analytics) | 06-05, 06-07 | ✓ SATISFIED | getLinkAnalytics + IDOR route + detail UI |
| TRACK-05 (global overview) | 06-05, 06-08 | ✓ SATISFIED | getGlobalAnalytics scoped + AnalyticsView |

No orphaned requirements — all five TRACK IDs are claimed by plans and marked Complete in REQUIREMENTS.md.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| AnalyticsView.vue | 12 | "coming soon" in comment | ℹ️ Info | Comment explicitly states there is NO "coming soon" copy — not a debt marker |

No blocking anti-patterns. No unreferenced TBD/FIXME/XXX markers in any Phase 6 source file.

### Human Verification

Already completed this session. `.planning/phases/06-internal-tracking-analytics/06-UAT.md` records 11/11 checkpoints passed, including the cold-start smoke test and both pixel-fidelity UI checkpoints (Surface A, C1/C2). The stale-SPA-build issue that initially blocked UI verification was resolved by rebuilding the app Docker image. No further human verification required.

### Gaps Summary

None. Every observable truth is verified against source and exercised by passing automated tests; all artifacts exist, are substantive, and are wired; all six phase prohibitions hold; all five requirements are satisfied; and human UAT is already recorded as fully passed. The one documented intentional gap (full member-role visibility enforcement, deferred to Phase 9 / TEAM-06) is out of scope for Phase 6 — the global overview is correctly domain-scoped to the caller's own domains, not the whole instance.

---

_Verified: 2026-07-20T10:50:00Z_
_Verifier: Claude (gsd-verifier)_
