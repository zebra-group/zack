# Pitfalls Research

**Domain:** Self-hosted URL shortener (Kurzly) — Vue 3 + Fastify + PostgreSQL/Prisma + better-auth, TDD-mandatory
**Researched:** 2026-07-10
**Confidence:** MEDIUM-HIGH (mix of HIGH-confidence official-docs findings for better-auth/qrcode, MEDIUM-confidence cross-checked web findings for infra topics, and HIGH-confidence well-established OWASP security patterns)

## Critical Pitfalls

### Pitfall 1: Open redirect / abuse of the shortener itself as a phishing vector

**What goes wrong:**
Because the entire product is "take a slug, redirect to an arbitrary URL," the shortener *is* an open redirector by design. Attackers register short links pointing to phishing/malware sites and rely on the shortener's clean, trusted-looking domain to bypass spam filters and user suspicion. A second, subtler failure: developers treat the shortener's own domains as "trusted" inside OAuth/OIDC redirect_uri allowlists or CORS configs, which lets an attacker who creates a malicious short link chain it into a real open-redirect against the app's own auth flow.

**Why it happens:**
Teams focus on "does the redirect work" and skip abuse-resistance because the redirect target is a legitimate stored feature, not a bug — so it doesn't look like the classic "unvalidated redirect" OWASP case at first glance.

**How to avoid:**
- Validate destination URLs at creation time with a real URL parser (`new URL()`), require `http(s)://` scheme only, reject `javascript:`, `data:`, `file:` schemes outright.
- Never add the shortener's own redirect/short-link paths to any OAuth `redirect_uri` allowlist or treat `*.yourdomain` as an inherently trusted origin for auth callbacks — auth callback allowlists must be exact-match, separate from the redirect-serving domains.
- Add a basic malicious-URL check at creation (e.g. reject known URL-shortener chains pointing to other shorteners to prevent redirect-laundering — optional but note as a documented limitation if skipped for MVP).
- Rate-limit link creation per account to slow bulk phishing-link generation (see Pitfall 6).

**Warning signs:** No URL scheme validation on the "Ziel-URL" field; short-link domains appear anywhere in an OAuth client's allowed redirect URIs; no audit log of who created which link.

**Phase to address:** Core Redirect Engine / Link Creation phase (validation), reinforced in Auth phase (never let redirect domains double as callback domains).

---

### Pitfall 2: SSRF via Open Graph tag fetching / bot preview generation

**What goes wrong:**
To render "Custom OG-Tags" social-card previews or to serve enriched OG tags to bots (Slack/Twitter/Facebook crawlers) hitting the redirect endpoint, the server must fetch the *target* URL's metadata (or the user-provided image URL) server-side. If that fetch isn't isolated, an attacker sets a link's target (or OG image URL) to `http://169.254.169.254/latest/meta-data/`, `http://localhost:5432`, or an internal service, and the server dutifully fetches it — classic SSRF, potentially leaking cloud metadata credentials or hitting internal-only admin endpoints.

**Why it happens:**
OG scraping feels like "just an HTTP GET," so it's implemented with a plain `fetch()`/`axios.get()` with no network-layer restriction, and redirect-following is left on by default (so even a validated public URL can 302 to an internal address at request time — this passes initial validation but not the final connection).

**How to avoid:**
- Custom OG-Tags per link (title/description/image) are **user-supplied text fields** in this project's spec — prefer NOT auto-fetching arbitrary metadata server-side at all; let users type title/description/image URL directly (per spec, screens show manual OG inputs, not auto-scraped ones). This sidesteps most of the SSRF surface for OG specifically.
- Wherever any server-side fetch of a user-controlled URL *is* needed (e.g. validating an image URL exists, or later auto-fill-OG-from-target feature): resolve DNS first, reject private/loopback/link-local/metadata IP ranges (RFC1918, 127.0.0.0/8, 169.254.0.0/16, ::1), re-validate the IP after every redirect hop (disable auto-follow-redirect, do it manually with a hop cap of ~3), restrict to `http`/`https` schemes only, set aggressive timeouts and response-size caps, and run the fetch through code that cannot reach the app's own internal network (separate egress path).
- Never reflect raw fetched HTML/JSON back into the dashboard unsanitized.

**Warning signs:** Any code path that does `fetch(userSuppliedUrl)` server-side without IP/DNS validation; OG image field silently proxied server-side "to avoid mixed content"; redirect-follow left at library default.

**Phase to address:** Custom OG-Tags feature phase — decide explicitly whether OG data is 100% user-typed (safe, spec-aligned) vs auto-fetched (needs SSRF hardening) before implementation starts.

---

### Pitfall 3: Password-protected / expired link target leaked before unlock

**What goes wrong:**
The real target URL, or enough of it, ends up in the initial HTML response, a JSON payload sent to the client before password verification, an HTTP `Location` header, meta-refresh tag, or even a same-origin OG preview — all of which a browser network tab (or a bot) can read without ever supplying the password or before the expiration check gate. This is an explicit hard constraint in this project's spec (screens 11/12).

**Why it happens:**
Common shortcut: fetch the full link record (including `target`) on the server for the "check password" page, render the page with the record serialized into a `<script>` inline JSON blob for the frontend to use "later," gating only the *redirect* on the client — but the target is already sitting in the page source.

**How to avoid:**
- The password/expiration gate must be enforced entirely server-side: the initial GET to a protected slug returns a page with **no target URL anywhere** in HTML/JSON/headers. Only a `POST /api/redirect/:slug/unlock` with the correct password returns the target (or triggers a same-request 302).
- For expired links: return `410 Gone` with the static "expired" page — never the target, never a 200 render of anything link-related.
- For bots/crawlers requesting OG previews on a password-protected or expired link: serve *generic* OG tags ("This link is protected" / "This link has expired") — never the real title/description/image tied to the actual target, since a bot can also be a manual curl probing the URL.
- Add an automated test (per TDD mandate) that asserts the raw HTTP response body/headers for a locked/expired link never contain the stored target string, using a canary target URL.

**Warning signs:** `res.send({ link })` anywhere in a password/expiry handler with the full record instead of a stripped DTO; view-source on the password page shows the destination; a `curl -I` or `curl -A "Slackbot"` shows real OG data for a protected link.

**Phase to address:** Password Protection & Expiration phase — write the "no-leak" test *first* per TDD before building the unlock flow.

---

### Pitfall 4: Server-side authorization enforced only in the UI ("Member" scoping)

**What goes wrong:**
The dashboard correctly hides domains a Member isn't assigned to, filters the domain-tab pills, and disables buttons — but the underlying API endpoints (`GET /links/:id`, `PATCH /links/:id`, QR remap, analytics aggregation) accept any authenticated user's request regardless of `user.domains[]`, because "the UI already filters it." A Member can then directly call the API (dev tools, curl, or a modified frontend build) to read/edit links, QR codes, or analytics belonging to domains they were never assigned.

**Why it happens:**
Authorization logic is naturally written once in the frontend to drive the UI, and it's tempting to consider that "done" — the backend check is a separate, easy-to-forget line of code per endpoint, especially across ~5 resource types (links, QR, domains, analytics, team).

**How to avoid:**
- Implement a single reusable server-side authorization helper/middleware — e.g. `assertDomainAccess(user, domainId)` — called at the top of *every* handler that touches a link, QR code, or analytics record, resolved via the record's `domainId`, not trusted from client input.
- Admins bypass the check; Members are checked against `user.domains[]` from the DB (never from a client-supplied role/domain claim in the request body).
- Write authorization as its own test suite independent of feature tests: for every mutating and read endpoint, assert a Member with no access to domain X gets 403/404 on domain X's resources, even when guessing valid IDs.
- Apply this uniformly to QR remap and the QR "maps to" link-picker endpoint too — a Member must not even be able to enumerate/select links from unassigned domains via the QR studio's target dropdown.

**Warning signs:** Any Fastify route handler that does DB reads/writes using only `req.params.id` without a `WHERE domainId IN (...)` or explicit ownership check; authorization logic that lives only in a Vue computed property or router guard; missing authz tests in the test suite despite feature tests being green.

**Phase to address:** Should be a cross-cutting concern established in the Auth/Roles phase (build the authorization helper first) and then verified per-feature in every subsequent phase (Links, QR, Analytics, Domains) — this is the single most likely candidate for a dedicated `gsd-secure-phase` retrofit if skipped.

---

### Pitfall 5: Slug enumeration and predictable auto-generated slugs

**What goes wrong:**
Auto-generated slugs are short, sequential, or drawn from a small alphabet/length, letting attackers enumerate all links in the system (scraping private/internal URLs meant to be "unlisted," or harvesting active password-protected/QR slugs to brute-force). This is compounded if the redirect endpoint doesn't rate-limit, turning enumeration into a fast automated scrape.

**Why it happens:**
Slug generation is often an afterthought (`nanoid(6)` copy-pasted without thinking about collision + guessability), and "unlisted, not secret" is assumed to be an acceptable security model without it being made an explicit product decision.

**How to avoid:**
- Use a cryptographically random ID generator (e.g. `nanoid` with a sufficiently large default alphabet and length ≥ 7-8) for auto-generated slugs — not sequential DB IDs, not short numeric counters.
- Custom/user-chosen slugs are fine to be human-readable (that's a feature), but document that custom slugs are inherently guessable and shouldn't be relied on as a security boundary for sensitive links — password protection exists for that reason.
- Rate-limit the public redirect endpoint per-IP (see Pitfall 6) specifically to blunt enumeration/brute-force, and ensure a miss (`slug not found`) and a hit-but-wrong-password look statistically similar in response time to avoid timing-based enumeration.

**Warning signs:** Slugs that increment predictably or are short (≤5 chars, low-entropy charset); no rate limiting on `GET /:domain/:slug`; response time or payload size differs measurably between "slug doesn't exist" and "slug exists but wrong password."

**Phase to address:** Core Redirect Engine / Link Creation phase (slug generation strategy chosen up front — expensive to migrate later since it's the primary key visitors see).

---

### Pitfall 6: Missing or misapplied rate limiting on redirect + create endpoints

**What goes wrong:**
Two distinct hot paths need different rate-limiting strategies and both get missed or conflated: (1) the public redirect endpoint (`GET /:domain/:slug`) must stay fast and available for legitimate high-volume traffic (a viral link, QR scan campaign) while still resisting slug-enumeration/brute-force scraping; (2) the authenticated link/QR/domain *creation* endpoints must resist bulk phishing-link generation and CSV bulk-import abuse. Teams often apply one blanket rate limit (or none) to both, either throttling legitimate redirect traffic or leaving creation endpoints wide open for abuse.

**Why it happens:**
Fastify's rate-limit plugin is trivial to bolt on globally, so the path of least resistance is one global limiter — which is wrong for a redirect-hot-path service where p99 latency and availability matter most on the read side.

**How to avoid:**
- Redirect endpoint: rate-limit per-IP with a generous ceiling tuned for legitimate burst traffic (e.g. campaign traffic, QR scan spikes), but tight enough to blunt scraping bots; consider exempting known good bot user-agents from the *redirect* limit while still gating them to the "generic OG only" behavior from Pitfall 3.
- Creation endpoints (link create, bulk import, QR create, domain add): rate-limit per-user/per-account, much stricter, since these are authenticated and low-frequency in legitimate use (a human doesn't create 500 links/minute).
- Bulk import (CSV) needs its own limit on rows-per-import and imports-per-hour independent of the per-link create limit.
- Magic-link request endpoint needs its own separate, strict rate limit (per-email and per-IP) to prevent email-bombing a target inbox (see Pitfall 9).

**Warning signs:** A single `@fastify/rate-limit` registration with one global config applied to all routes; load-testing the redirect path shows it throttling under realistic legitimate traffic; no limit on `/api/auth/magic-link` or bulk-import endpoints.

**Phase to address:** Core Redirect Engine phase (redirect-path limiter) and Link Creation / Auth phases respectively (creation and magic-link limiters) — should be planned as distinct, not one generic ticket.

---

### Pitfall 7: Wrong HTTP status codes on redirect edge cases (410 vs 404, bot handling)

**What goes wrong:**
Expired links return `404 Not Found` instead of the spec-required `410 Gone`, which is both a UX miss (visitor page can't distinguish "never existed" from "existed, now dead") and an SEO/crawler correctness issue (`410` explicitly tells crawlers/link-checkers to stop retrying and deindex, `404` implies it might come back). Separately, redirect handlers frequently mishandle case-sensitivity (`/Abc123` vs `/abc123` should not silently 404 if slugs are meant to be case-sensitive — or should be normalized consistently, not inconsistently across create vs lookup) and trailing slashes (`/abc123/` treated as a different, nonexistent slug from `/abc123`).

**Why it happens:**
The distinction between "gone" and "not found" isn't obvious until explicitly required (as it is here), and slug lookups are often implemented as a raw string-equality DB query without normalization applied identically at write-time (slug creation) and read-time (redirect lookup) and without an explicit trailing-slash strip step in the route matcher.

**How to avoid:**
- Explicit state machine per lookup: `slug not found` → 404 (generic Kurzly "not found" page, not the app's default framework error page); `found + expired` → 410 with the spec's expired page; `found + password-protected + not yet unlocked` → 200 password-prompt page (never a redirect status); `found + valid` → 302 (or 307 if method/body preservation matters — not applicable here) to target with UTM appended.
- Normalize slugs identically at creation and lookup time (pick one policy — case-sensitive is simplest and matches the Monospace/dev-tool aesthetic of the product; document it) and strip/ignore a single trailing slash at the router level before slug lookup.
- Reserve a list of slugs that can never be user-assigned (see Pitfall 8) so routing collisions with dashboard/API paths can't produce confusing 404s.

**Warning signs:** Expired-link manual test returns 404; `/slug` and `/slug/` behave differently; `/SLUG` vs `/slug` behavior isn't covered by any test.

**Phase to address:** Core Redirect Engine phase — write the status-code contract as a table in the phase spec and TDD it (one test per state: not-found/expired/password-locked/valid) before writing the handler.

---

### Pitfall 8: Reserved slugs colliding with dashboard/API/system routes

**What goes wrong:**
A user (or self-service-adjacent invite flow) creates a link with slug `api`, `admin`, `login`, `q` (the dynamic-QR prefix!), `assets`, `.well-known`, or similar, which either 404s unpredictably depending on route-matching order, silently shadows a real system route, or — worse — actually succeeds in routing traffic meant for the dashboard/API to a redirect handler (or vice versa) if the shortener and dashboard share a domain/path space.

**Why it happens:**
The redirect handler is usually a catch-all route (`/:slug`) registered after specific routes, so ordering *usually* saves you — until a new system route is added later and nobody re-checks for slug collisions, or until custom domains mean the "same" path space is reused differently across dashboard-domain vs customer-domains.

**How to avoid:**
- Maintain an explicit reserved-slugs list (`api`, `app`, `admin`, `login`, `logout`, `auth`, `q`, `_next`, `assets`, `static`, `.well-known`, `favicon.ico`, health-check paths, etc.) enforced at slug-creation validation time (both manual and bulk-import), independent of route-matching order.
- Since dynamic QR codes use a `/q/:code` path (per spec), `q` itself must be reserved as a top-level link slug to avoid ambiguity between "a link literally named q" and "the QR redirect namespace."
- Keep the redirect catch-all route physically separate (different Fastify plugin/prefix or even a separate service) from dashboard/API routes so a slug can never structurally shadow a system path, and add a regression test that iterates the reserved list and asserts creation is rejected for each.

**Warning signs:** No reserved-slug validation exists at all; `/q/` prefix isn't blocked from regular link slugs; adding a new dashboard route isn't accompanied by an update to the reserved list.

**Phase to address:** Core Redirect Engine / Link Creation phase, revisited when the QR feature (which introduces the `/q/` namespace) is added.

---

### Pitfall 9: better-auth magicLink gotchas — email prefetch consuming single-use tokens, deliverability, expiry mismatch with UX copy

**What goes wrong:**
Three distinct failure modes bundle under "magic link just doesn't work sometimes": (1) corporate email security scanners (Microsoft Defender/Proofpoint-style link-scanning bots) or email client "preview" fetchers open the magic-link URL server-side before the human clicks it — since better-auth tokens are single-use and deleted atomically on first verification, the *scanner's* fetch consumes the token, and the real user's click then fails with an opaque `INVALID_TOKEN` error with no indication why; (2) self-hosted SMTP (the spec's provider-neutral nodemailer setup) has no reputation/warm-up, so magic-link emails land in spam or get greylist-delayed past the (default 5-minute, spec says 15-minute) expiry window, making login look broken; (3) the login page's copy states one expiry duration while the actual `expiresIn` config is a different value (spec explicitly says 15 minutes — must be set explicitly, since better-auth's default is 300s/5 minutes, not 15).

**Why it happens:**
Single-use + short expiry is the correct security default, but it interacts badly with real-world email infrastructure (scanners, self-hosted SMTP) in ways that only show up once real email providers/corporate inboxes are in the loop — dev testing with a local mail catcher (Mailhog/Maildev) never exercises this.

**How to avoid:**
- Explicitly set `expiresIn: 900` (15 min) to match the spec/UI copy — don't rely on better-auth's 5-minute default silently disagreeing with what the login screen tells users.
- Design the magic-link URL to require an explicit user action (a "Confirm sign-in" button on landing, not an auto-redirecting GET-and-done) so a bot's GET request lands on a harmless confirmation page instead of silently consuming the token — this single change avoids most of the scanner-prefetch class of support tickets.
- Document a minimal SMTP deliverability checklist in the setup docs (SPF/DKIM/DMARC records for the sending domain, since self-hosted means no shared sender reputation) and add a clear resend flow (already implied by the "← andere E-Mail verwenden" screen) so a delayed/spam-filtered email doesn't dead-end the user.
- In tests, mock the email transport (don't hit real SMTP in CI) but keep one manual/E2E smoke test against a real SMTP relay (e.g. Mailpit in CI, real provider in a staging smoke test) to catch template/deliverability regressions.

**Warning signs:** Users reporting "link says invalid" on first click; magic-link expiry value in code doesn't match the "15 Minuten" copy in the login screen spec; no SPF/DKIM guidance in deployment docs; tests only cover the token-generation function, never the full request→email→verify round trip.

**Phase to address:** Auth (better-auth / Magic Link) phase.

---

### Pitfall 10: better-auth OIDC/SSO — default role not actually applied, callback misconfiguration

**What goes wrong:**
The spec requires new SSO-provisioned users to default to role `member`. A common implementation mistake: returning `role: 'member'` from `mapProfileToUser` (or the generic-OAuth profile mapper) and assuming that's sufficient — but `mapProfileToUser` only shapes fields at initial user-record creation and does not reliably flow custom fields like `role` into the session object unless the user/session schema and serialization explicitly include it. Result: SSO users are created with no role at all (failing every domain-authorization check, effectively locked out) or inherit an unintended default from the schema. Separately, the callback path (`/api/auth/callback/oidc` per spec) must exactly match what's registered in the external OIDC provider (Keycloak/Authentik/Azure AD) — a scheme (`http` vs `https`) or trailing-slash mismatch causes a silent redirect_uri_mismatch that's painful to debug self-hosted since there's no vendor support line to call.
  
**Why it happens:**
better-auth's plugin architecture makes `mapProfileToUser` look like "the" place to set derived fields, but its guarantees are narrower than they appear; OIDC redirect_uri exact-matching is an OIDC-wide gotcha, not better-auth-specific, and self-hosted deployments (custom domain, reverse proxy stripping/adding paths) are especially prone to it.

**How to avoid:**
- Do not rely on `mapProfileToUser` alone for `role`. Use a database/`user.create` hook (server-owned, post-creation) to explicitly force `role = 'member'` for any user whose account was created via the OIDC provider, and add a test asserting a freshly-provisioned SSO user has `role === 'member'` and zero assigned domains (matching the Member default-access model).
- Document and test the exact callback URL end-to-end (including scheme and any reverse-proxy path rewriting) as part of the Domains/Deployment phase, not just the Auth phase, since self-hosted reverse-proxy config is often the actual point of failure.
- Add a config-validation startup check that fails fast (clear error) if OIDC is enabled but issuer/client fields are incomplete, rather than failing opaquely on first login attempt.

**Warning signs:** SSO users appear in the Team table with blank/undefined role; `redirect_uri_mismatch` errors from the OIDC provider with no clear self-hosted debugging guidance; role-assignment logic lives only in `mapProfileToUser` with no accompanying hook or test.

**Phase to address:** Auth (OIDC/SSO) phase — the default-role behavior needs its own explicit test, not just "SSO login works."

---

### Pitfall 11: QR code with logo overlay breaks scannability (wrong/default error-correction level)

**What goes wrong:**
QR codes generated with the default error-correction level (most JS QR libraries, including `qrcode` on npm, default to `M` ≈ 15% recoverable) still render fine visually with a logo overlaid in the center — but the logo now covers more "damage" than the code can recover from, so a meaningful fraction of printed/exported codes silently fail to scan on real phones. This is easy to miss in dev because on-screen digital rendering rarely gets tested with the actual physical constraint (print size, camera angle, low light) that reveals the failure.

**Why it happens:**
The "logo in the middle" toggle and the "error correction level" setting are logically two different concerns to a developer (visual composition vs. QR encoding parameter) and are frequently implemented independently, without wiring the logo toggle to force `errorCorrectionLevel: 'H'`.

**How to avoid:**
- Hardcode (or default-and-lock) `errorCorrectionLevel: 'H'` whenever a logo is enabled for a QR code — don't leave it as an independent user-facing option when a logo is present; the spec itself calls this out explicitly ("Fehlerkorrektur-Level entsprechend hoch wählen, z. B. H").
- Cap logo size as a percentage of the QR's total area (commonly recommended: ≤ ~20-25% of the code area) even with H-level correction — an oversized logo can still break scannability regardless of error-correction level; validate/clamp the logo overlay dimensions rather than trusting whatever the user uploads.
- Maintain the minimum 4-module quiet zone (margin) around the entire code in both PNG and SVG export — a logo colliding with or a design that shrinks the quiet zone to "look tighter" is a separate common scannability killer.
- Add an automated test that decodes the *generated* QR image (round-trip: generate → decode with a QR-reading library in the test) for both logo-on and logo-off configurations, asserting the decoded content matches the expected target — this catches error-correction regressions that a purely visual snapshot test would miss.

**Warning signs:** QR generation code sets `errorCorrectionLevel` once globally rather than conditionally on logo presence; no automated decode-round-trip test exists, only visual/snapshot tests; logo size is unbounded/user-controlled without a max-percentage clamp.

**Phase to address:** QR Codes phase — the decode-round-trip test should be written before the logo-overlay implementation (TDD).

---

### Pitfall 12: QR SVG vs PNG export inconsistency

**What goes wrong:**
PNG and SVG exports of "the same" QR code are generated via different code paths (e.g. server-side PNG via canvas/sharp, client-side SVG via a different library or manual string templating for the logo overlay), leading to subtle mismatches: the SVG version doesn't correctly cut out/mask the module area under the logo (leaving jagged edges or overlapping modules), rounded-module styling applied in PNG isn't replicated in SVG (or vice versa), or the SVG's embedded logo is a raster `<image>` with a broken/relative path that doesn't render when the SVG file is opened standalone outside the app (a common gotcha since SVG `<image>` hrefs need to be inlined as data URIs to be portable, not left as app-relative URLs).

**Why it happens:**
QR generation libraries commonly have first-class PNG/canvas support but bolt-on or manual SVG support, and logo compositing (masking QR modules under the logo, adding the white padding ring) is easy to implement once (e.g. canvas compositing for PNG) and forget to mirror for the vector path.

**How to avoid:**
- Pick a single source of truth for the "logo mask" geometry (module count, logo size/position as a fraction of total size) and derive both PNG and SVG output from the same computed geometry, not two independently-tuned implementations.
- For SVG export, always inline the logo as a base64 data URI inside the exported SVG (never a relative/app URL), so the exported file is fully self-contained and portable (matches the "print-ready export" use case implied by the QR feature).
- Round-trip-decode test (Pitfall 11) should run against **both** exported formats, not just one, since they can silently diverge.

**Warning signs:** SVG export "looks right" in-app (rendered inline where relative logo paths still resolve) but is broken when downloaded and opened standalone; only PNG has a decode test; visual QA only checks the in-app preview, never the actual downloaded file.

**Phase to address:** QR Codes phase.

---

### Pitfall 13: Let's Encrypt rate limits and on-demand cert issuance abuse for multi-domain hosting

**What goes wrong:**
On-demand TLS (issuing a certificate at first handshake for a newly-verified customer domain, rather than pre-provisioning) is the right approach for "attach any domain a customer owns" — but without gating *which* hostnames are allowed to trigger issuance, an attacker who can point arbitrary DNS at the instance's IP (trivial — DNS is public) can trigger unbounded ACME order attempts against the account, exhausting Let's Encrypt's hard limits (300 new orders per account per 3 hours; 50 certs per registered domain per week) and taking down certificate issuance for *legitimate* customer domains queued behind the abuse. Separately, a domain that's added in the dashboard but whose DNS verification is polled/race-prone can trigger issuance attempts before the CNAME/DNS record has actually propagated, burning failed-validation attempts against the same rate-limit budget.

**Why it happens:**
"On-demand TLS" tutorials focus on the happy path (a real customer, a real domain) and gloss over the fact that the ask-endpoint gate is not optional in a multi-tenant/public-facing context — it's the only thing standing between "customers can add domains" and "anyone on the internet can burn your cert budget."

**How to avoid:**
- Implement an explicit "ask" callback (Caddy's on-demand TLS `ask` endpoint, or equivalent gating logic if using a different ACME client/reverse proxy) that only allows certificate issuance for domains that exist in the DB with a `pending` or `active` status *and* have passed the app's own DNS-verification check — never issue on bare "someone connected with this SNI."
- Only attempt issuance after DNS verification succeeds server-side (actual DNS lookup confirming the CNAME/A record points correctly), not optimistically on every dashboard "DNS prüfen" click — debounce/backoff repeated verification-triggered issuance attempts for the same domain.
- Set a hard `max_certs` (or equivalent) ceiling on the reverse proxy so a bug or abuse can't silently exhaust the whole account even with the ask-gate in place.
- For expected larger self-hosted deployments (many customer domains on one instance), document that DNS-01 challenges may be required for wildcard/bulk scenarios since HTTP-01 on-demand at high domain counts can approach weekly limits — call this out as a scaling consideration in deployment docs even if out of scope for MVP.

**Warning signs:** No ask-endpoint/gating logic between "domain added in dashboard" and "reverse proxy will attempt ACME for that SNI"; DNS verification is client-triggered only (button click) with no server-side re-check before issuance; no monitoring/alerting on ACME issuance failures.

**Phase to address:** Domains & TLS phase — the ask-gate is a hard prerequisite before shipping multi-domain support, not a later hardening pass.

---

### Pitfall 14: Host-header spoofing / domain confusion in the redirect handler

**What goes wrong:**
Since redirect behavior and per-link authorization are keyed off "which domain is this request for," a redirect handler that trusts the raw `Host` header (or `X-Forwarded-Host` behind a reverse proxy without validating it against a known-domains allowlist) can be tricked into serving a link registered under Domain A's slug space when the actual TLS/SNI connection was for Domain B, or can be used to probe which domains/slugs exist by sending arbitrary `Host` headers directly to the app port (bypassing the TLS-terminating proxy entirely if the app is reachable on an internal network/port without its own host validation).

**Why it happens:**
Multi-tenant-by-domain routing is usually implemented as "look up domain from `req.hostname` and query links where `domain = that`" without validating that the hostname is one of the instance's actually-registered, verified domains first — so an unregistered/spoofed Host header falls through to a generic "not found" *or worse* matches an unintended domain row due to loose string matching.

**How to avoid:**
- Maintain the source of truth for "which hostnames this instance answers for" as the verified-domains table, and reject (fast 404, no further processing) any request whose `Host`/`X-Forwarded-Host` doesn't exactly match an `active` domain row — never fall back to "just try the lookup anyway."
- If running behind a reverse proxy (Caddy/nginx), ensure the app only trusts `X-Forwarded-Host` from the proxy itself (bind the app to a private network/socket, not a publicly reachable port) so the header can't be spoofed by a direct request bypassing the proxy.
- Slug lookups should be scoped by the verified domain's ID (foreign key), never by matching the raw hostname string against a `links.domainName` text column, to avoid subtle case/whitespace/punycode-confusable mismatches.

**Warning signs:** Redirect handler code reads `req.headers.host` directly without cross-checking it against the domains table's `active` set; the app is reachable on a port/network path that skips the reverse proxy; domain matching is a string `===` against user-editable text rather than a foreign-key join.

**Phase to address:** Domains & TLS phase, verified again in Core Redirect Engine phase (the lookup query itself).

---

### Pitfall 15: Privacy/tracking toggle doesn't actually stop data collection ("off" still logs)

**What goes wrong:**
The per-link tracking toggle is implemented as a *display* filter (click events are always written to the DB, but the UI/analytics queries hide them when tracking is "off") rather than actually gating the write path — so turning tracking off doesn't stop data collection, it just stops showing it, which is both a spec violation ("bei 'aus' werden keine Klickdaten gespeichert") and a real privacy/GDPR problem if this is ever audited or if a data subject requests deletion and it's discovered click data existed all along.

**Why it happens:**
It's simpler to always write the click event (uniform code path) and filter at read-time than to branch the write path per-link, especially since the write happens in the hot redirect path and an extra per-request "is tracking on for this link" check feels like unwanted complexity there — but this is exactly backwards from a privacy standpoint.

**How to avoid:**
- The redirect handler must check the link's `tracking` flag *before* deciding whether to write a click-event row at all — no event row should ever exist for a tracking-off link, not even a soft-deleted or flagged one.
- Country/referrer capture (GDPR-appropriate, no third parties per spec) should use only data already present in the request (Referer header for referrer; IP→country via a local, self-hosted, periodically-updated GeoIP database such as a self-hosted MaxMind GeoLite2 or DB-IP lite dataset bundled/downloaded at deploy time — never send the visitor's IP to a third-party geolocation API) and must discard/never persist the raw IP address itself once country is derived (store only the derived country code, not the IP, to minimize retained PII).
- Add a test that toggles tracking off, fires N redirects through a link, and asserts zero rows exist in the click-events table for that link's ID — not just that the analytics view returns zero.
- Toggling tracking *on* later should not retroactively fabricate historical data — analytics for the "before it was turned on" period should show a real gap/zero, not be a data-integrity concern but a UX one worth documenting.

**Warning signs:** Click-event writes happen unconditionally in the redirect handler with filtering only in the analytics query layer; raw IP addresses stored in the click-events table; any outbound call to a third-party geolocation/analytics API.

**Phase to address:** Internal Tracking / Analytics phase — the "off means zero rows written" behavior should be the first TDD test written for this phase, before the analytics dashboard itself.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|-----------------|
| Store full link record (incl. target) in a single API response and filter password/expiry client-side | Faster to build detail views | Target leakage before unlock (Pitfall 3) — a real security bug, not just debt | Never |
| One global rate-limit config for all routes | One line of Fastify plugin config | Either throttles legitimate redirect traffic or leaves creation/auth endpoints exploitable (Pitfall 6) | Never for production; fine for a local dev-only build |
| Skip the reserved-slugs list at MVP | Faster link-creation flow to ship | Silent route collisions once new system paths are added, especially the `/q/` QR namespace (Pitfall 8) | Acceptable only if the reserved list is added before enabling public/self-service link creation by non-admins |
| Write click events unconditionally, filter at query time | Simpler redirect handler code | Privacy/spec violation — data exists that shouldn't (Pitfall 15) | Never |
| Use PrismaClient default connection pool sizing without PgBouncer | Nothing to configure, works immediately in dev | Connection pool exhaustion once multiple app instances/redirect-hot-path load appears in production | Acceptable for single-instance MVP behind low traffic; must be revisited before horizontal scaling |
| No partitioning on click_events table at launch | Simpler schema, one migration | Query/index bloat and slow retention pruning once the table reaches millions of rows | Acceptable at MVP scale; plan the partitioning migration before analytics query latency becomes user-visible, not after |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|-------------------|
| better-auth `magicLink()` | Relying on the library default `expiresIn` (300s) while UI copy says 15 minutes | Explicitly set `expiresIn: 900` to match spec/UI copy |
| better-auth generic OIDC | Assuming `mapProfileToUser` alone sets/persists the default `member` role for SSO users | Force role assignment via a `user.create` hook, test it explicitly |
| Let's Encrypt / on-demand TLS (Caddy or equivalent) | No `ask` endpoint gating issuance; issuance triggered before DNS verification actually succeeds | Gate issuance on DB `active`/verified status + server-side DNS re-check; cap with `max_certs` |
| `qrcode` npm | Leaving `errorCorrectionLevel` at default `M` once logo overlay is added | Force `H` whenever a logo is present; decode-round-trip test both formats |
| Prisma + PostgreSQL | New `PrismaClient()` instantiated per request or per Fastify plugin instance | Singleton client, reused across the app; add PgBouncer transaction pooling ahead of scale |
| Self-hosted SMTP (nodemailer) | No SPF/DKIM/DMARC guidance, magic links land in spam and expire before delivery | Document DNS auth-record setup in deployment docs; add resend UX |
| GeoIP for country tracking | Calling a third-party geolocation API per click (violates "no third-party tracking") | Bundle/download a local GeoIP database (e.g. GeoLite2/DB-IP) and resolve locally, store only the country code |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Redirect handler does a full ORM `include` (joins to QR history, analytics aggregates, etc.) just to resolve target + status | Redirect p99 latency creeping up as related data grows | Redirect lookup should be the leanest possible query: slug/domain → target/status/tracking-flag only; fetch everything else lazily elsewhere | Noticeable once click_events or QR-history tables reach tens of thousands of rows and get accidentally joined |
| Unpartitioned `click_events` table with no time-based index strategy | Analytics queries and retention deletes get progressively slower | Range-partition by month from the start (or plan the migration early); index on `(link_id, created_at)` | Becomes painful in the low millions of rows, worse once monthly analytics queries scan the whole table |
| Prisma connection pool sized identically per horizontally-scaled instance | Random `connection pool timeout` errors under load that don't correlate with total request volume | PgBouncer transaction-mode pooling in front of Postgres; conservative per-instance `connection_limit` | Breaks as soon as more than 1-2 app instances run concurrently against a small `max_connections` Postgres |
| Redirect endpoint rate limiter using an in-memory store in a multi-instance deployment | Rate limits appear inconsistently enforced (each instance has its own counter) | Use a shared store (Redis) for rate-limit state once running more than one instance | Breaks the moment the redirect service is scaled beyond one process |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Treating "Member" authorization as a UI-only concern | Full data read/write access to unassigned domains via direct API calls | Server-side authorization helper enforced on every link/QR/analytics/domain endpoint (Pitfall 4) |
| Embedding the real target URL in any pre-unlock/pre-expiry-check response | Password/expiration protections are trivially bypassed by reading the network response | Server never serializes `target` until the gate passes; automated "no-leak" test with a canary URL (Pitfall 3) |
| No SSRF hardening on any server-side fetch of user-controlled URLs | Internal network/cloud-metadata access, credential leakage | Prefer manual OG-tag entry (per spec) over auto-fetch; if fetch is ever added, validate IPs post-DNS-resolution and post-redirect (Pitfall 2) |
| Redirect domain reused as an OAuth/OIDC trusted callback origin | Open-redirect-via-shortener chained into auth-flow compromise | Keep auth callback allowlists exact-match and entirely separate from redirect-serving domains (Pitfall 1) |
| Trusting raw `Host`/`X-Forwarded-Host` header for domain-scoped slug lookups | Domain confusion, host-header spoofing, cross-domain data exposure | Validate host against the verified-domains table; bind app to a private network reachable only via the proxy (Pitfall 14) |
| No gating on which hostnames can trigger Let's Encrypt issuance | Rate-limit exhaustion DoS against your own cert issuance by any internet user pointing DNS at your IP | Ask-endpoint gated by DB verification status; `max_certs` ceiling (Pitfall 13) |
| Storing raw visitor IP addresses for country lookups | Unnecessary PII retention, GDPR exposure | Resolve country locally at write time, persist only the country code, discard the IP (Pitfall 15) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Magic-link expiry silently shorter than what the login page tells the user | Users click a "valid" link past its real expiry and get a confusing generic error | Match `expiresIn` config to displayed copy exactly; show a clear "link expired, resend" state instead of a raw error |
| Generic framework 404 page for unknown slugs instead of the branded "not found" experience | Visitors see a bare Fastify/Node error page, undermining trust in a public-facing redirect | Explicit branded 404/410/password/expired pages for every redirect outcome, matching screens 11/12 |
| QR code exported at low resolution or without adequate quiet zone for print use cases | Codes fail to scan once printed on physical material (flyers, packaging) | Export at a print-appropriate resolution/vector (SVG) with the mandated ≥4-module quiet zone preserved |
| Domain "DNS ausstehend" status with no feedback on *why* verification hasn't succeeded yet | Admins stuck re-clicking "DNS prüfen" with no diagnostic info | Surface the actual DNS lookup result (what was found vs. expected CNAME) when verification fails |
| Analytics dashboard shows a flat zero for the period before tracking was turned on, indistinguishable from "no traffic happened" | Confusing interpretation of historical charts | Visually distinguish "tracking was off" periods from genuine zero-traffic periods on the click chart |

## "Looks Done But Isn't" Checklist

- [ ] **Password-protected links:** Often missing a server-side "no-leak" guarantee — verify by inspecting the raw HTTP response (headers + body) for a locked link with browser devtools/curl and confirming the target string never appears before unlock.
- [ ] **Member role authorization:** Often only enforced in the Vue router/UI — verify by calling every links/QR/analytics/domains API endpoint directly (curl/Postman) as a Member against a domain they're not assigned to and confirming 403/404, not 200.
- [ ] **Expired links:** Often return 404 instead of 410 — verify with `curl -I` against a manually-expired test link and check the actual status code, not just that "an expired page shows."
- [ ] **QR codes with logos:** Often generated with default (M) error correction — verify by decoding the actual exported PNG/SVG file with a real QR-reading library or physical phone scan, not just visual inspection.
- [ ] **Tracking-off links:** Often still write click_events rows, just hidden from the UI — verify by querying the database directly after firing redirects through a tracking-off link.
- [ ] **Custom domains + TLS:** Often works for the developer's manually pre-tested domain but has no gating against arbitrary Host headers — verify by sending a request with a spoofed/unregistered `Host` header directly to the app and confirming it's rejected, not silently matched.
- [ ] **Bulk CSV import:** Often validates format but not the same authorization/reserved-slug/rate-limit rules that manual link creation enforces — verify by importing a CSV containing a reserved slug and a domain the importing Member isn't assigned to.
- [ ] **Magic link flow:** Often only tested with a local mail-catcher — verify the real single-use/expiry/resend behavior end-to-end at least once against a realistic SMTP relay, and test the "link opened by a scanner bot before the human clicks" scenario explicitly.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Target leakage discovered post-launch (Pitfall 3) | MEDIUM | Patch the response serialization immediately (strip target from all pre-unlock payloads); audit access logs for evidence of scraping; consider rotating/re-issuing affected password-protected links if abuse is suspected |
| Member authorization gap discovered post-launch (Pitfall 4) | HIGH | Audit logs to determine what unauthorized data was actually accessed by which accounts; patch the authorization helper and retrofit it across all endpoints; notify affected domain owners per your incident-response policy |
| Slug enumeration led to scraping of unlisted links (Pitfall 5) | MEDIUM | Add rate limiting retroactively; rotate/re-slug sensitive links if their guessable slugs were the actual exposure vector; add password protection where warranted |
| Click-events written despite tracking-off (Pitfall 15) | MEDIUM-HIGH | Delete the improperly-collected rows for affected links; patch the write path to check the flag before insert; document the incident if any deleted-user-data / GDPR obligation applies |
| Let's Encrypt rate limit exhausted by abuse (Pitfall 13) | LOW-MEDIUM | Implement the ask-gate immediately; wait out the rolling rate-limit window (hours, not days, for the 3-hour order limit); consider a temporary staging/backup CA (Let's Encrypt staging or ZeroSSL) while the production limit resets |
| QR codes already printed with broken (unscanned) logo overlays | LOW (digital), HIGH (if already physically printed/distributed) | Fix `errorCorrectionLevel` going forward; for dynamic QR codes the underlying `/q/:code` URL is stable, so *new* codes with corrected generation can reuse the same short URL if reprinting is feasible, but already-distributed physical prints cannot be retroactively fixed |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Open redirect / phishing abuse (1) | Core Redirect Engine / Link Creation | Test: link creation rejects non-http(s) schemes; auth callback allowlist audit contains no shortener redirect paths |
| SSRF via OG fetching (2) | Custom OG-Tags phase | Test/design review: confirm OG data is user-typed, not auto-fetched; if fetch exists, test SSRF-blocked IP ranges |
| Target leakage before unlock (3) | Password Protection & Expiration | "No-leak" canary test on raw HTTP response for locked/expired links |
| Server-side authorization gaps (4) | Auth/Roles phase (helper built), verified every feature phase | Authz test suite: Member denied access to unassigned-domain resources across every endpoint |
| Slug enumeration (5) | Core Redirect Engine / Link Creation | Entropy check on generated slugs; rate-limit test on redirect endpoint |
| Rate limiting gaps (6) | Core Redirect Engine (redirect limiter) + Link Creation/Auth (creation & magic-link limiters) | Load test confirms distinct limiter behavior per route class |
| Wrong status codes / bot handling (7) | Core Redirect Engine | Status-code contract table tested per state (404/410/200-locked/302) |
| Reserved slug collisions (8) | Core Redirect Engine / Link Creation, revisited at QR phase | Test iterates reserved-slug list, asserts rejection, includes `q` |
| Magic-link token/expiry/deliverability (9) | Auth (Magic Link) phase | E2E test against real/staging SMTP; expiry config matches UI copy; bot-prefetch scenario tested |
| OIDC default role / callback config (10) | Auth (OIDC/SSO) phase | Test: freshly-provisioned SSO user has role=member, zero domains; callback URL verified end-to-end through reverse proxy |
| QR logo error-correction (11) | QR Codes phase | Decode-round-trip test on logo-enabled QR codes (PNG + SVG) |
| QR SVG/PNG export inconsistency (12) | QR Codes phase | Decode-round-trip test on both export formats from shared geometry source |
| Let's Encrypt rate limits / on-demand issuance abuse (13) | Domains & TLS phase | Ask-gate exists and is tested; issuance never attempted before DB verification status is `active` |
| Host-header spoofing (14) | Domains & TLS phase, verified in Core Redirect Engine | Test: spoofed/unregistered Host header rejected; app unreachable except via proxy |
| Tracking-off still collecting data (15) | Internal Tracking / Analytics phase | Test: zero click_events rows exist after redirects through a tracking-off link |

## Sources

- [OWASP Foundation — Open Redirect](https://owasp.org/www-community/attacks/open_redirect)
- [OWASP Cheat Sheet Series — Unvalidated Redirects and Forwards](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html)
- [Fastly — Open redirects: real-world abuse and recommendations](https://www.fastly.com/blog/open-redirects-real-world-abuse-and-recommendations)
- [Better Auth — Magic Link plugin docs](https://better-auth.com/docs/plugins/magic-link)
- [better-auth GitHub Discussion #6985 — Magic Link token consumed by email security scanners/preview bots](https://github.com/better-auth/better-auth/discussions/6985)
- [better-auth GitHub Discussion #3517 — Single-use vs reusable magic links and expiresIn](https://github.com/better-auth/better-auth/discussions/3517)
- [Better Auth — Generic OAuth plugin docs](https://better-auth.com/docs/plugins/generic-oauth)
- [better-auth GitHub Discussion #3290 — mapProfileToUser field mapping](https://github.com/better-auth/better-auth/discussions/3290)
- [better-auth GitHub Issue #5480 — mapProfileToUser updates DB only once](https://github.com/prisma/prisma/issues/5480)
- [qrcode — npm package docs](https://www.npmjs.com/package/qrcode)
- [QRLynx — QR Code Error Correction Levels Explained: Which to Use & When H Hurts](https://qrlynx.com/blog/qr-code-error-correction-levels-explained)
- [QR Code Design Best Practices: 15 Rules for Scannable Codes](https://www.qr-insights.com/blog/2026-03-03-qr-code-design-best-practices)
- [Prisma Documentation — Connection pooling in Prisma Postgres](https://www.prisma.io/docs/postgres/database/connection-pooling)
- [Prisma Documentation — Configure Prisma Client with PgBouncer](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
- [Prisma GitHub Issue #22732 — Excessive DB connections with PgBouncer in PM2 clustered environment](https://github.com/prisma/prisma/issues/22732)
- [Caddy Documentation — Automatic HTTPS / On-Demand TLS](https://caddyserver.com/docs/automatic-https)
- [Caddy Community — How to prevent on-demand TLS from exhausting Let's Encrypt limits](https://caddy.community/t/how-to-prevent-on-demand-tls-from-exhausting-let-s-encrypt-limits-for-sigstr-net-while-keeping-wildcard-renewal-reliable/33702)
- [Let's Encrypt Community — Rate limit and account creation for many domains on Caddy](https://community.letsencrypt.org/t/rate-limit-and-accounts-creation-for-100k-domains-on-caddy/215146)
- [PortSwigger Web Security Academy — Server-side request forgery (SSRF)](https://portswigger.net/web-security/ssrf)
- [OWASP Foundation — Server Side Request Forgery](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery)
- [Severalnines — Advanced Partitioning Strategies for PostgreSQL OLTP and Analytics Datasets at Scale](https://severalnines.com/blog/advanced-partitioning-strategies-for-postgresql-oltp-and-analytics-datasets-at-scale/)
- [Heroku — Handling Very Large Tables in Postgres Using Partitioning](https://www.heroku.com/blog/handling-very-large-tables-in-postgres-using-partitioning/)
- Project-specific: `.planning/PROJECT.md` (security constraints: server-side authorization, no target leakage, 410 on expiry, TDD mandate) and `design_handoff_url_shortener/README.md` (screens 11/12 backend hints, better-auth role model, QR/error-correction note)

---
*Pitfalls research for: self-hosted URL shortener (Kurzly) — Vue 3 + Fastify + PostgreSQL/Prisma + better-auth*
*Researched: 2026-07-10*
