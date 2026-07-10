# Feature Research

**Domain:** Self-hosted URL shortener / link management platform (Kurzly)
**Researched:** 2026-07-10
**Confidence:** MEDIUM (well-documented domain; competitor feature sets confirmed via multiple current sources; some edge-case behaviors are inferred best practice rather than directly cited)

## Context

The product spec (12 requirements, `design_handoff_url_shortener/README.md`) is already fixed and full-scope for v1 — this is not a "what should we cut" exercise. This document's job is to (a) place the 12 requirements against the wider market (bit.ly, dub.co, Kutt, YOURLS, Shlink) so the roadmap knows which pieces are commodity vs. genuinely differentiating, and (b) surface **expected sub-behaviors the spec text glosses over**, because those sub-behaviors are exactly where phase plans under-scope and rewrites happen later.

Competitor landscape snapshot:
- **Shlink** — self-hosted, Docker-first, real-time visit tracking, multi-domain, REST API. Closest architectural sibling to Kurzly's ambitions.
- **YOURLS** — PHP/MySQL, oldest and most established self-hosted option, plugin ecosystem, minimal built-in analytics.
- **Kutt** — Node.js/TypeScript, self-hostable, password-protected links, custom domains, API — feature set close to Kurzly's baseline but no team/role model.
- **dub.co** — the explicit reference point in the spec ("wie bei dub" for UTM builder). Open-core, Next.js. Full feature set: UTM builder, custom link previews (OG), device/geo targeting, password protection, expiration, QR codes, real-time analytics with geo/device/browser/referrer breakdowns, up to N custom domains per workspace, team roles.
- **bit.ly** — market incumbent, sets user expectations for dynamic QR codes (redirect history retained across remaps) and standard link attributes.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any product in this class. Missing these makes Kurzly feel unfinished next to Kutt/Shlink/dub, even though the spec doesn't over-explain them.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Custom slug + auto-generated slug fallback | Every competitor (bit.ly, dub, Kutt, YOURLS) supports both; users expect empty slug to "just work" | LOW | Spec confirms: empty slug → autogenerate. Collision handling (retry with longer random suffix) must be specified — spec is silent on this. |
| Multi-domain link creation with domain picker | Table stakes for any "bring your own domain" shortener (Shlink, dub, Rebrandly) | MEDIUM | Requires DNS verification flow (spec has this) + per-domain slug uniqueness (a slug is unique *within* a domain, not globally — spec implies this via `example.com/kurz` per domain, but this must be an explicit DB constraint: `UNIQUE(domain_id, slug)`). |
| Redirect handler (the core value prop) | This is the entire product; if it's slow or wrong, nothing else matters | MEDIUM | See Pitfalls-adjacent notes below — the spec under-specifies status code choice, precedence order of checks, and 404 vs 410 distinction. |
| Click count display | Every competitor shows a click count on the link list; users compare "which link performs" | LOW | Already spec'd (tracking toggle). Must gracefully show "—" when tracking is off (spec already calls this out). |
| Copy-to-clipboard for short link | Universal micro-interaction across bit.ly/dub/Kutt/YOURLS | LOW | Already spec'd. |
| Static QR code per link | Every modern shortener (bit.ly, dub) auto-generates a QR for any short link; users expect it without extra setup | LOW | `qrcode` npm library, straightforward. Distinct from *dynamic* QR (separate entity in spec). |
| Search/filter on link list | Any list beyond ~20 rows needs this; YOURLS, Kutt, dub all have it | LOW | Already spec'd (search field + domain-filter pills). |
| Link expiration → dead link handling | dub has this ("expiration dates" is explicitly listed as a dub feature) | LOW-MEDIUM | Spec correctly identifies 410 Gone as the right status (see Pitfalls note on why 410, not 404). |
| Password-protected links | dub, Kutt both support this | MEDIUM | Spec correctly requires server-side hashing and never embedding the target before verification — this is good instinct already captured in spec; needs a session/short-lived-token mechanism after unlock (see below). |
| CSV/bulk import | Any tool used by an agency (Kurzly's stated persona) needs migrating hundreds of existing links | MEDIUM | Spec has this as Screen 10. Needs to handle partial failure gracefully (already spec'd: N valid / M skipped). |
| Team invite + role-based access | dub has "team roles"; any multi-user self-hosted tool needs at least this | MEDIUM | Spec's 2-role model (Admin/Member) is a deliberately simplified version of what dub/Bitly Enterprise offer (which often has 3-4 roles) — correctly scoped down per Out-of-Scope. |
| Dark/light theme | Not competitively differentiating, but modern dashboards (dub, Vercel-style tools) all have it; its absence would look dated | LOW | Already spec'd, tokens defined. |

### Differentiators (Competitive Advantage)

Where Kurzly can genuinely compete, mostly on **self-hosted + privacy + on-prem control**, which none of dub/bit.ly offer and which Shlink/YOURLS/Kutt don't do as polished/complete as the spec describes.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dynamic QR codes with own short URL + remap history | bit.ly has this at Enterprise-tier pricing; Shlink/YOURLS/Kutt do not have this at all. A print-once, redirect-forever QR is genuinely valuable for agencies doing physical collateral (posters, packaging) | MEDIUM-HIGH | Needs its own entity distinct from links (spec models this correctly: `qrs[]` with `mapsTo -> linkId`, `history[]`). Remap history is the differentiator — competitors that have dynamic QR often don't surface history to the user; Kurzly's spec explicitly shows it (Screen 4: "gerade geändert" toast + dashed history line). |
| Privacy-first internal tracking, toggleable per link, zero third-party | This is the stated Core Value in PROJECT.md. No competitor combines self-hosted + no-third-party + per-link opt-out this cleanly; Shlink/YOURLS have analytics but not a privacy-first architecture story; dub/bit.ly are SaaS (data leaves your infra) | MEDIUM | Must actually honor "off = store nothing" at the DB layer (no rows written, not soft-deleted/hidden) — this is a trust claim, and quality bar is high: any leaked click row when tracking is off is a broken promise, not just a bug. |
| Per-domain role scoping (not just per-workspace) | dub/Bitly scope by *workspace/team*, not by *domain within one instance*. Kurzly's model (one instance, N domains, Members scoped to specific domains) fits the agency-with-many-clients use case better than dub's workspace model | MEDIUM-HIGH | This is architecturally the most novel piece of the spec — see PITFALLS/ARCHITECTURE for the "authorize every operation server-side" requirement. Differentiator only if enforcement is airtight; a leaky implementation turns this into a liability, not a feature. |
| OIDC/SSO on a free self-hosted OSS tool | Enterprise-grade auth options are usually paywalled (bit.ly Enterprise, dub Enterprise); giving this away in a self-hosted OSS project is a real draw for companies with existing Keycloak/Authentik/Azure AD | MEDIUM | better-auth's generic OIDC plugin makes this tractable; the differentiator is packaging/UX (toggle + 3 fields), not novel auth engineering. |
| Custom OG-tags + social card live preview | dub has "custom link previews" but doesn't show a true multi-platform preview UI; most self-hosted tools (YOURLS, Kutt) don't have this at all | MEDIUM | Requires bot-vs-human branching in the redirect handler (see Pitfalls) — the preview UI itself (Screen 3, accordion section 2) is cheap; the *serving* mechanism is the real engineering work. |
| UTM builder with live preview | Explicitly modeled on dub, which has this; Shlink/YOURLS/Kutt do not | LOW-MEDIUM | Straightforward URLSearchParams manipulation; the differentiator is doing it self-hosted with no data going to a third party's attribution engine. |
| Full Docker/Compose on-prem deployment story | dub/bit.ly are SaaS-only for teams that want the full feature set; Shlink/YOURLS are self-hostable but have a much thinner feature set (no dynamic QR, no team roles, no OIDC) | HIGH (product-level, not a single feature) | This is the overall differentiator: "the only self-hosted option with the full dub-like feature set." Everything else in this table serves this positioning. |

### Anti-Features (Deliberately Not Building)

Already excluded per PROJECT.md Out of Scope: email/password login, third-party analytics (GA etc.), public self-signup, roles beyond Admin/Member, billing. Additional anti-features surfaced by this research:

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Full attribution/marketing suite (A/B testing, device targeting, deep links, geo-targeting redirects) | dub has these; feels like "if we're already matching dub, why not match all of it" | Scope creep against the fixed 12-requirement spec; device/geo-based *conditional redirects* (different target per device/country) is a materially different redirect-handler architecture (multi-target resolution before the 302) — not a toggle, a redesign | Explicitly defer; the spec's redirect handler resolves one link → one target. If ever requested, treat as a new major version, not a phase add-on. |
| Public self-service link shortening (anonymous, no login) | Every consumer-facing shortener (tinyurl, bit.ly free tier) allows this; "just paste a URL" is the most familiar mental model | Directly conflicts with PROJECT.md's "no public self-signup" and the per-domain authorization model — an anonymous link has no owner/domain-scope to authorize against, and is also a classic open-redirect/spam vector for self-hosted tools left on the public internet | Team-invite-only creation, as already spec'd. |
| Third-party/browser-fingerprint-based analytics enrichment (device fingerprinting, cross-site tracking pixels) | "More analytics = more value" instinct, and competitors like dub show device/browser/OS breakdowns | Directly contradicts the stated Core Value (privacy-first, no third-party tracking); fingerprinting also reintroduces exactly the GDPR/consent-banner problem the privacy-first architecture is meant to avoid | Stick to referrer + country (from IP→GeoIP lookup, IP itself discarded) + click timestamp; this is enough for the "top referrers / top links / time series" aggregations the spec asks for. |
| Full plugin/extension marketplace (à la YOURLS' 245+ plugins) | YOURLS' longevity is partly attributed to its plugin ecosystem; tempting to build an extension API for "future-proofing" | Massive scope and API-surface commitment for a spec that has zero mention of extensibility; premature abstraction | Ship the fixed feature set well; revisit extensibility only if/when a v2 milestone explicitly asks for it. |
| CAPTCHA/anti-bot gating on password-protected or expired link pages | Seems like sensible hardening against brute-forcing per-link passwords | Not in spec, adds a UX/dependency burden (CAPTCHA provider = a third party in the request path for a *public* page, undermining self-hosted/no-third-party positioning) | Rate-limit password attempts per-link per-IP server-side (simple in-memory or DB counter) instead of introducing a third-party CAPTCHA service. |
| Storing target URL or password in a query param, hash fragment, or inline `<script>` on the password/expired pages | Naive/fast implementation path when serving these public pages | Explicitly called out as a security requirement to avoid in PROJECT.md/spec ("Ziel-URL erst nach erfolgreicher Prüfung ausgeliefern, nie im HTML der Sperrseite einbetten") — get this wrong and the password gate is cosmetic only | Resolve target server-side only after password POST validates; issue redirect from the server response, never client-side reveal. |

## Under-Specified Sub-Behaviors (Spec Gaps to Resolve Before/During Planning)

These are expected industry behaviors the 12 requirements imply but don't fully pin down. Flagging them now so phase plans don't have to rediscover them mid-build.

### Redirect handler semantics
- **Status code choice is unspecified for the "happy path" redirect** (only 410-for-expired is spec'd). Industry norm for link shorteners: **302 (or 307) by default, not 301** — 301s are cached by the browser, which (a) breaks click-count accuracy after the first visit, and (b) prevents the target from ever being changed for users who already visited once (their browser silently skips the shortener forever). Recommend: 302 default for all links, always (even ones without tracking) — it's the correct default for a "target can change" product regardless of whether tracking is on, since consistent behavior matters for QR remapping too. Confidence: MEDIUM (cross-source consensus, not from official spec).
- **Precedence order of checks is unspecified.** A redirect can be simultaneously expired AND password-protected AND requested by a bot. Order matters: recommend checking **expiration first** (410, terminal — nothing else should matter once gone), then **password gate** (if set, before revealing anything), then **bot detection → OG-tag page** vs **real visitor → redirect + click event**. This ordering should be an explicit decision written into the phase plan for the redirect handler, not discovered in code review.
- **404 vs 410 distinction matters and the spec gets it right** for expired links (410 Gone, not 404) — but the spec doesn't say what happens for a slug that **never existed** (domain+slug not found at all). Standard behavior: true 404 in that case, distinct from expired-410. Both need a public page (not a raw HTTP error), consistent with the spec's designed "abgelaufen" page pattern.
- **OG-tag injection must be bot-only, and the mechanism must not be spoofable-security-critical.** Server-side User-Agent matching (e.g. via the `isbot` npm package's regex list for facebookexternalhit/Twitterbot/Slackbot/LinkedInBot/Discordbot/etc.) is the standard approach — but UA strings are trivially spoofable, so this check must ONLY gate "serve HTML-with-meta-tags vs. issue redirect," never bypass password/expiration checks. A malicious actor spoofing a bot UA should still hit the password gate / 410 page, not get a free peek at OG data for a protected/expired link. Confidence: MEDIUM.
- **Password unlock needs a short-lived proof mechanism**, not just "check password, then redirect once." Spec's UI (Screen 11) implies a single POST → unlock → redirect flow, but if the visitor's browser is also going to load OG-preview assets or the redirect needs to survive a page transition, a short-lived signed token/cookie (e.g. 60s validity, single-use) is the standard pattern — otherwise the "Unlocked" state shown in the prototype has nothing to actually redirect from. This is a real implementation decision missing from the spec, not just a formatting detail.

### QR codes
- **Error correction level** must be H (30% redamage tolerance) specifically because of the logo overlay — spec already notes this correctly. Sub-behavior not spec'd: minimum logo size ratio (industry rule of thumb: logo should occupy ≤ ~20-25% of the QR code area at EC level H, else scan reliability degrades) — worth pinning as a concrete constraint (spec says 46×46px logo in a 196px/21-module QR, which is roughly in-range but should be validated against the actual generated matrix, not just visually).
- **Dynamic QR remap needs an audit trail schema**, not just a `history[]` display array — who remapped, when, from/to. Spec shows the UI (dashed history line) but the data model implication (append-only remap log table, not an overwritten field) should be explicit in the DB schema, else "history" silently becomes "last change only."
- **Static vs dynamic QR are genuinely different entities**, not a toggle on one entity: a static QR encodes the destination URL directly (no server round-trip, can't ever be remapped without reprinting); a dynamic QR encodes `/q/xxxx` and requires its own redirect-resolution path (which itself needs point-in-time click/scan tracking separate from link clicks, since the spec calls out a distinct "scan counter"). Recommend explicitly modeling `qrs.dynamic: boolean` and branching the render+redirect logic on it, per spec's own data model — just flagging that this isn't a cosmetic difference, it's two code paths.

### Tracking / analytics
- **"Off = store nothing" is a hard architectural constraint, not a UI filter.** Must be enforced at the point of write (no click-event row created at all when tracking is off for that link), not by hiding rows in the aggregation query. Any implementation that logs-then-filters is a false claim of the privacy feature and a compliance/trust risk given this is the product's Core Value.
- **Unique visitor counting without cookies/third-party** needs a defined method since the spec asks for "Unique Visitors" as an aggregation but doesn't specify how uniqueness is derived. Standard privacy-preserving approach (as used by Plausible/Fathom/Umami): hash `IP + User-Agent + daily-rotating-salt` with SHA-256 to derive an ephemeral daily visitor ID; discard the salt at day-boundary so the same person can't be correlated across days. Raw IP itself is never persisted — only used transiently to (a) derive that hash and (b) do a GeoIP country lookup, then discarded. Confidence: MEDIUM (cross-source consensus from Plausible/Fathom/Umami documentation, standard pattern not spec-mandated but directly serves the stated Core Value).
- **Referrer parsing needs normalization**, not raw storage of the `Referer` header — grouping `t.co`, `twitter.com`, `x.com` etc. into recognizable sources is expected polish (dub/bit.ly do this) but the spec doesn't call it out; recommend at minimum bucketing into "direct / social / search / other" plus raw domain, since raw unprocessed referrer strings make the "Top Referrers" aggregation noisy and low-value on day one.

### Multi-domain + per-domain roles
- **Slug uniqueness scope**: confirmed above — must be unique per domain, not globally, since the spec's model is `domain + slug → target`.
- **Domain deletion/deactivation cascading behavior is unspecified**: what happens to existing links when a domain is removed or DNS verification is later revoked? Recommend: domain can be deactivated (existing links keep resolving, but slug creation is blocked) rather than hard-deleted, to avoid silently breaking already-distributed short links — flag this as a decision needed during the Domains-screen phase, not left implicit.
- **Member domain-access changes must invalidate cached authorization**, not just update the DB row — if role/domain-assignment changes happen while a member has an active session, the very next request must reflect the new scope (server-side check on every request, as the spec already mandates — just noting that "every operation" includes requests made seconds after a change, so no long-lived authorization cache/JWT claims baking in stale domain lists).

## Feature Dependencies

```
Multi-domain support
    └──requires──> Domain DNS verification + TLS (Let's Encrypt)
                       └──enables──> Custom short-link creation per domain

Redirect handler (core)
    ├──requires──> Domain + slug resolution (multi-domain)
    ├──gates──> Password protection (check before serving target)
    ├──gates──> Expiration check (410, checked before password/OG)
    ├──branches on──> Bot detection ──> OG-tag HTML page (read-only, no click event)
    └──branches on──> Human visitor ──> Click event (if tracking on) ──> redirect

Dynamic QR codes
    └──requires──> Links (a QR maps to a link, not a raw URL)
                       └──requires──> Remap history log (append-only)

Static QR codes
    └──requires──> Links (encodes the link's URL directly; no server dependency after generation)

Per-link tracking toggle
    └──gates──> Click-event write (off = no rows written, not filtered)
                       └──enables──> Analytics aggregations (time series, top links, top referrers, unique visitors, countries)

UTM builder
    └──enhances──> Link creation (appends params to target URL at creation time, not at redirect time)

Custom OG-tags
    └──requires──> Bot detection in redirect handler (to decide HTML-page vs redirect)

Team/role management
    ├──requires──> Auth (better-auth: magic link default)
    ├──requires──> Domain-scoped authorization enforced server-side on EVERY link/QR/analytics operation
    └──enables──> OIDC/SSO (optional; new SSO users default to Member role)

Bulk CSV import
    └──requires──> Link creation logic (reuses same validation/slug-generation path, not a separate code path)
```

### Dependency Notes

- **Redirect handler requires multi-domain resolution first**: the handler can't look up a link without first resolving which domain the incoming request is on — multi-domain support is architecturally a prerequisite phase, not a parallel one.
- **Expiration gates before password**, and both gate before bot-detection branching: get this order wrong (e.g. showing an OG preview for an expired or password-protected link to a spoofed bot UA) and you leak target metadata that should have been hidden — this is the single most safety-critical ordering decision in the whole spec.
- **Dynamic QR requires Links to exist as a concept** (a dynamic QR always points at a link, never directly at a raw target URL) — so QR-code phase work depends on Links phase work being done first, per the spec's own data model (`qrs[].mapsTo → linkId`).
- **Tracking toggle gates Analytics entirely**: the global Analytics screen (Screen 5) can only aggregate over links that have tracking on — this should be an explicit `WHERE tracking = true` filter at the query layer, and the phase plan for Analytics should assume some/most/all links may be excluded.
- **Team/role management requires Auth to exist before it's meaningful**: invitations, magic-link sending, and pending/active status all depend on better-auth's magicLink() plugin being wired up first — Auth is a dependency of Team management, not a peer.
- **OIDC/SSO conflicts with nothing, but is additive**: it's a second auth method layered onto the same user/role model, not a replacement — new SSO users still land in the same `users` table with `role: member` default, so it depends on the role model already existing, not the other way around.

## MVP Definition

Per PROJECT.md, this is explicitly **not** an MVP-cut milestone — the Active requirements section states v1 = all 12 requirements, no deliberate feature cutting for launch. This section is included per template convention but should be read as **phase sequencing guidance**, not scope reduction.

### Launch With (v1 — all spec'd, per PROJECT.md)

- [ ] Docker/Compose hostability — infra foundation, needed before anything is demoable
- [ ] Multi-domain link creation + redirect handler (301/302/307 decision, 404/410 distinction) — the stated Core Value; everything else is worthless if this is wrong
- [ ] Password protection + expiration (410 Gone) — directly gates the redirect handler's correctness
- [ ] Internal privacy-first tracking (toggle, store-nothing-when-off) — second half of Core Value
- [ ] Static + dynamic QR codes with remap history — explicitly spec'd, no smaller cut available
- [ ] UTM builder, custom OG-tags — spec'd, moderate complexity, no reason to defer
- [ ] Bulk CSV import — spec'd, reuses link-creation validation logic
- [ ] Team/role management (Admin/Member, per-domain scoping) — required for the agency/multi-client persona to be usable at all
- [ ] Magic-link auth (better-auth) — required for any team feature to function
- [ ] OIDC/SSO (optional, toggle) — spec'd as v1, not deferred

### Add After Validation (v1.x)

Not requested by the spec, but natural next asks once real usage starts (flag for future milestones, not this one):
- [ ] Referrer bucketing/normalization polish (social/search/direct grouping) if raw referrer data proves too noisy in practice
- [ ] Domain deactivation/soft-delete UX refinement if the "what happens when a domain is removed" question surfaces in real use

### Future Consideration (v2+)

Explicitly out of scope per PROJECT.md and this research — do not let these creep into phase plans:
- [ ] Device/geo-targeted conditional redirects (different target per device/country) — architecturally a different redirect model
- [ ] A/B testing on links — not requested, not aligned with self-hosted-simplicity positioning
- [ ] Plugin/extension marketplace — premature abstraction for a fixed-spec v1
- [ ] Roles beyond Admin/Member — explicitly out of scope in PROJECT.md

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Redirect handler (multi-domain, status codes, 410) | HIGH | MEDIUM | P1 |
| Multi-domain + DNS verification | HIGH | MEDIUM | P1 |
| Password protection + expiration | HIGH | MEDIUM | P1 |
| Privacy-first tracking (toggle, aggregations) | HIGH | MEDIUM-HIGH | P1 |
| Static QR codes | MEDIUM | LOW | P1 |
| Dynamic QR codes + remap history | HIGH (differentiator) | MEDIUM-HIGH | P1 |
| UTM builder + live preview | MEDIUM | LOW | P1 |
| Custom OG-tags + bot-branching serve logic | MEDIUM (differentiator) | MEDIUM-HIGH | P1 |
| Bulk CSV import | MEDIUM | MEDIUM | P1 |
| Team/role management, per-domain scoping | HIGH (differentiator) | MEDIUM-HIGH | P1 |
| Magic-link auth | HIGH | LOW-MEDIUM (better-auth handles most of it) | P1 |
| OIDC/SSO | MEDIUM (differentiator for enterprise) | MEDIUM | P1 |
| Referrer normalization polish | LOW-MEDIUM | LOW | P2 |
| Domain deactivation UX | LOW | LOW | P2 |

**Priority key:** all P1 items are already committed per PROJECT.md's "full spec, no MVP cut" decision — this column reflects relative build-order risk (get P1-HIGH-value + P1-HIGH-risk items like the redirect handler and privacy-tracking store-nothing-guarantee right first, since they're both Core Value AND hardest to retrofit correctly).

## Competitor Feature Analysis

| Feature | dub.co | Shlink | Kutt | YOURLS | Kurzly's Approach |
|---------|--------|--------|------|--------|--------------------|
| Self-hosted | No (SaaS, open-core) | Yes | Yes | Yes | Yes (Docker/Compose, on-prem, hard requirement) |
| Multi-domain | Yes (per workspace, paid tiers) | Yes | Yes | Via plugins | Yes, native, per-instance with DNS verification UI |
| Dynamic QR w/ remap history | Built-in QR, no confirmed remap-history UI | No | No | No | Yes — explicit differentiator, own `/q/xxxx` entity + audit trail |
| UTM builder w/ live preview | Yes | No | No | No | Yes, modeled directly on dub |
| Custom OG-tags + social preview | Yes ("custom link previews") | No | No | No | Yes, with bot-branching redirect handler |
| Password-protected links | Yes | Partial | Yes | Via plugins | Yes, server-hashed, target never pre-revealed |
| Internal privacy-first tracking (toggle, no 3rd party) | No (own hosted analytics, data leaves your infra) | Yes (basic) | Basic | Basic (plugin-dependent) | Yes — Core Value; explicit "store nothing when off" guarantee |
| Team roles | Yes (workspace-based) | No | No | No (single-admin model) | Yes — Admin/Member, per-domain scoped (finer-grained than dub's workspace model) |
| OIDC/SSO | Enterprise tier only | No | No | No | Yes, free, via better-auth generic OIDC |
| Bulk import | Via API | Via API/CLI | Via API | Via plugins | Yes, dedicated CSV UI with live validation preview |

## Sources

- [How Short.io Is Better Than Self-Hosted Link Shorteners — Short.io Blog](https://blog.short.io/how-short-io-is-better-than-self-hosted-link-shorteners/)
- [Best Self-Hosted URL Shorteners in 2026: Shlink, YOURLS & More | selfhosting.sh](https://selfhosting.sh/best/url-shorteners/)
- [Dub.co Alternatives: Top 12 URL Shorteners | AlternativeTo](https://alternativeto.net/software/dub/)
- [Dub Links Overview - Dub](https://dub.co/help/article/dub-links)
- [Dub: Open Source Alternative to TinyURL, Bitly and Rebrandly](https://openalternative.co/dub)
- [301 vs. 302 Redirects in URL Shorteners: Speed, SEO, and Caching Best Practices](https://url-shortening.com/blog/301-vs-302-redirects-in-shorteners-speed-seo-and-caching)
- [Redirection Status Codes: 301, 302, 307, and 308 | Baeldung on Computer Science](https://www.baeldung.com/cs/redirection-status-codes)
- [How to Create Short Links With 301, 302, 307, 308 Status — Short.io Blog](https://blog.short.io/how-to-create-short-links-with-301-302-307-308-status/)
- [isbot - npm](https://www.npmjs.com/package/isbot)
- [GitHub - omrilotan/isbot: Detect bots/crawlers/spiders using the user agent string](https://github.com/omrilotan/isbot)
- [Meta Crawler Bot — Detection, User-Agent & Management | Switch](https://www.switchtheweb.com/agents/meta-crawler)
- [Edit QR Code Destination and Design: A Guide | Bitly](https://bitly.com/blog/edit-qr-code/)
- [Dynamic QR Codes 101 & 201: Examples & Expert Tips | Bitly](https://bitly.com/blog/dynamic-qr-codes/)
- [Static vs. Dynamic QR Codes: What Enterprises Need to Know | Bitly](https://bitly.com/blog/static-vs-dynamic-qr-codes/)
- [Privacy-Friendly Analytics Guide (2026) - Clickport](https://clickport.io/blog/privacy-friendly-analytics-guide)
- [GDPR compliant website analytics without cookies - Fathom Analytics](https://usefathom.com/blog/anonymization)
- [GitHub - plausible/analytics: Open source, privacy-first web analytics](https://github.com/plausible/analytics)
- [Self-Hosted Analytics Without DPAs: GDPR, HIPAA, CCPA Guide | OpenPanel Analytics](https://openpanel.dev/articles/better-compliance-self-hosted-analytics)
- Project spec: `design_handoff_url_shortener/README.md` (internal, 12 requirements + 12 screens)
- Project context: `.planning/PROJECT.md` (internal)

---
*Feature research for: Self-hosted URL shortener (Kurzly)*
*Researched: 2026-07-10*
