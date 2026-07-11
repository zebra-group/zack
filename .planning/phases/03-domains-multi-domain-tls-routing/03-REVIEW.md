---
phase: 03-domains-multi-domain-tls-routing
reviewed: 2026-07-11T18:25:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - apps/api/prisma/schema.prisma
  - apps/api/src/app.ts
  - apps/api/src/env.ts
  - apps/api/src/lib/dnsClient.ts
  - apps/api/src/lib/domainResolution.ts
  - apps/api/src/lib/authorization.ts
  - apps/api/src/plugins/rateLimit.ts
  - apps/api/src/routes/domains.ts
  - apps/api/src/routes/tlsCheck.ts
  - apps/web/src/api.ts
  - apps/web/src/router/index.ts
  - apps/web/src/views/DomainsView.vue
  - docs/deployment/reverse-proxy.md
  - .env.example
  - packages/shared/src/index.ts
  - apps/api/test/dnsClient.test.ts
  - apps/api/test/domainResolution.test.ts
  - apps/api/test/domains.integration.test.ts
  - apps/api/test/tlsCheck.integration.test.ts
  - apps/web/test/DomainsView.test.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-11T18:25:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

`resolveActiveDomainByHost` itself is sound — exact-match, deny-by-default, correctly
normalizes case/port on the *read* side, and the unit suite (`domainResolution.test.ts`)
directly exercises the spoofing/substring/pending/failed/whitespace cases the phase
called out. `verifyDomain` is genuinely SSRF-safe (DNS-only, timeout-bounded, never
throws past its boundary) and the authorization chain
(`requireDomainAccess`/`scopedDomainIds`) is deny-by-default with good test coverage for
IDOR/role-escalation on verify/delete/instructions.

However, there is a real gap **upstream** of `resolveActiveDomainByHost`: `POST
/api/domains` never normalizes the hostname it persists (no `.toLowerCase()`, no
trailing-dot strip, no format validation), while the read-side guard *always*
lowercases the incoming host before comparing. That asymmetry breaks the intended
"one verified owner per hostname" invariant — see CR-01 below, which is the headline
finding of this review. Three further robustness/quality issues (unvalidated
`?domain=` query type on the unauthenticated `tls-check` endpoint, missing hostname
format validation, and an uncleared DNS-timeout timer) round out the warnings.

## Critical Issues

### CR-01: Missing hostname normalization on create defeats the unique-hostname / DNS-ownership-proof invariant, and can permanently strand a verified domain

**File:** `apps/api/src/routes/domains.ts:55-58` (schema), `:139-172` (create handler)
**Related:** `apps/api/src/lib/domainResolution.ts:23` (`rawHost.toLowerCase()`), `apps/web/src/views/DomainsView.vue:79` (`newHostname.value.trim()` — no `.toLowerCase()` either)

**Issue:**

`createDomainSchema` only constrains length (`min(1).max(255)`) — it never lowercases,
trims, or strips a trailing dot before the hostname is used for the uniqueness
pre-check and persisted:

```ts
const createDomainSchema = z.object({
  hostname: z.string().min(1).max(255),
  type: z.enum(["subdomain", "apex"]),
});
...
const existing = await tx.domain.findUnique({ where: { hostname } }); // exact string
...
const created = await tx.domain.create({ data: { hostname, ... } });  // exact string
```

Postgres's default `hostname` unique index is case-sensitive (no `citext`, no
functional index), so `"example.com"` and `"EXAMPLE.com"` (or `"example.com."` with a
trailing dot) are treated as two *distinct* rows and both pass the uniqueness
pre-check/constraint. `apps/web/src/views/DomainsView.vue`'s `handleAddDomain` only
calls `.trim()`, never `.toLowerCase()`, so nothing upstream closes this gap either —
any authenticated allowlisted user (not just the true DNS owner) can hit `POST
/api/domains` with a case- or trailing-dot-variant of a hostname someone else already
owns and verified.

This has two concrete, provable consequences:

1. **DNS-ownership-proof bypass.** DNS resolution is case-insensitive (RFC 1035) and
   tolerant of a trailing dot. `POST /:id/verify` calls
   `dns.resolveCname(domain.hostname)` / `dns.resolve4(domain.hostname)` directly on
   the unnormalized stored value (`dnsClient.ts:52`). If the *real* owner already
   configured `example.com`'s CNAME correctly, an unrelated second user who registers
   `EXAMPLE.com` (or `example.com.`) will get an identical, matching DNS answer and
   their row will flip to `status: "active"` too — despite that user never having
   configured or controlled any DNS for that domain. The verify step is supposed to
   prove *this caller* controls the zone; the case/dot gap means it only proves "some
   zone answering to a DNS-equivalent string returns the right record," which anyone
   can observe for a domain they don't own. This directly undermines the "one Domain
   row / one verified owner per hostname" invariant the `@@unique` constraint and the
   owner-`DomainMembership` bootstrap transaction were built to guarantee — and later
   phases (link creation scoped to domain ownership) will inherit this hole.
2. **A legitimately verified domain can become permanently unreachable.** If an
   operator or team ever creates a domain with any non-lowercase casing (nothing
   in the API or UI prevents this), it can still reach `status: "active"` (DNS
   verification is case-insensitive), but `resolveActiveDomainByHost` **always**
   lowercases the incoming `Host`/SNI before its `findUnique` lookup
   (`domainResolution.ts:23,26`). A stored hostname that isn't already
   lowercase can never be found by that lookup — the TLS-check ask endpoint (and the
   Phase 5 redirect engine that reuses this same function, per its own header comment)
   will show "Aktiv ✓" in the dashboard while permanently 404/deny-ing real traffic for
   that domain. This is a direct violation of the project's stated core value
   ("Kurzlinks... zuverlässig kürzen und weiterleiten").

Neither `domains.integration.test.ts` nor `domainResolution.test.ts` covers
creating/verifying a domain with a non-lowercase or trailing-dot hostname, so this gap
has no regression coverage today.

**Fix:** Normalize (trim + lowercase + strip a trailing dot) in the Zod schema so the
normalized form is what's checked for uniqueness *and* persisted — the single
normalization point closes both the ownership-proof bypass and the "verified but
unreachable" trap:

```ts
const createDomainSchema = z.object({
  hostname: z
    .string()
    .min(1)
    .max(255)
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/\.$/, "")),
  type: z.enum(["subdomain", "apex"]),
});
```

Also add an integration test asserting that creating `EXAMPLE.com` after
`example.com` is already registered returns `409` (proving the normalization actually
feeds the uniqueness check), and that a domain created via the API always has a
lowercase `hostname` in the DB.

## Warnings

### WR-01: Unvalidated `?domain=` query type on the unauthenticated tls-check endpoint can crash the handler instead of returning a clean 404

**File:** `apps/api/src/routes/tlsCheck.ts:41-42`
**Related:** `apps/api/src/lib/domainResolution.ts:23`

**Issue:** `const { domain } = request.query as { domain?: string };` is an unchecked
type assertion, not a runtime check. Fastify's default query-string parser turns a
repeated key (`GET /api/tls-check?domain=a&domain=b`) into an array
(`{ domain: ["a", "b"] }`). `resolveActiveDomainByHost` then executes
`rawHost.toLowerCase()` on that array — `Array.prototype` has no `toLowerCase`, so this
throws a `TypeError` inside the handler. Since this endpoint is deliberately
unauthenticated (any client, including the internet at large, can query it directly —
`?domain=` is attacker-controlled per this phase's own threat model) and sits on the
TLS handshake critical path, an uncaught exception here turns into a generic 500
instead of the intended deny-safe 404. It doesn't grant a bypass (500 ≠ 200, so Caddy
still refuses issuance), but it is an easy, unauthenticated crash on a hot path with no
test coverage for this input shape.

**Fix:** Validate the query param's type before calling into the resolver, either via
an explicit guard or a Fastify route schema:

```ts
app.route({
  method: "GET",
  url: "/api/tls-check",
  config: { rateLimit: TLS_CHECK_RATE_LIMIT },
  schema: { querystring: { type: "object", properties: { domain: { type: "string" } } } },
  handler: async (request, reply) => {
    const { domain } = request.query as { domain?: string };
    ...
```

### WR-02: No hostname format validation on domain creation

**File:** `apps/api/src/routes/domains.ts:55-58`, `apps/web/src/views/DomainsView.vue:78-99`

**Issue:** `createDomainSchema` only checks length (1-255 chars); there is no
hostname-shape validation (no label-length/charset check) anywhere in the request
path, server or client. A caller (including via direct API use, bypassing the UI) can
register a whitespace-only string, an all-symbols string, or anything else that merely
satisfies `min(1).max(255)`. Such rows will simply fail DNS verification forever, but
they still occupy a row, consume the unique-hostname namespace, and appear in the
dashboard as a real, if perpetually-failing, domain — pure noise/quality issue, not
independently exploitable, but combined with CR-01's missing normalization it widens
the surface of "garbage but persisted" hostnames.

**Fix:** Add a hostname format check alongside the CR-01 normalization, e.g.:

```ts
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
hostname: z.string().min(1).max(255).trim().toLowerCase()
  .transform((v) => v.replace(/\.$/, ""))
  .pipe(z.string().regex(HOSTNAME_RE, "Invalid hostname")),
```

### WR-03: DNS verification timeout timer is never cleared

**File:** `apps/api/src/lib/dnsClient.ts:51-56`

**Issue:** `verifyDomain` races the resolver call against a bare `setTimeout` promise:

```ts
const records = await Promise.race([
  type === "subdomain" ? resolver.resolveCname(hostname) : resolver.resolve4(hostname),
  new Promise<string[]>((_resolve, reject) => {
    setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs);
  }),
]);
```

When the resolver settles first (the common case), the `setTimeout` handle is never
captured or cleared — the timer stays alive for up to `timeoutMs` (default 5000ms)
after every successful/fast verify call, needlessly holding a reference. Low
real-world impact (Node keeps running regardless), but it's needless resource churn on
a route that can be called repeatedly (`POST /:id/verify`, rate-limited but still up to
10 times/5min per caller), and it's a pattern that tends to trip up test-runner
"leaked timer" warnings.

**Fix:**

```ts
let timer: NodeJS.Timeout | undefined;
try {
  const records = await Promise.race([
    type === "subdomain" ? resolver.resolveCname(hostname) : resolver.resolve4(hostname),
    new Promise<string[]>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs);
    }),
  ]);
  ...
} catch (err) {
  ...
} finally {
  clearTimeout(timer);
}
```

## Info

### IN-01: `POST /api/domains` has no dedicated per-route rate limit

**File:** `apps/api/src/routes/domains.ts:135`, `apps/api/src/plugins/rateLimit.ts`

**Issue:** `POST /:id/verify` and `GET /api/tls-check` both get purpose-tuned
`config.rateLimit` overrides (`VERIFY_RATE_LIMIT`, `TLS_CHECK_RATE_LIMIT`), but domain
*creation* only inherits the permissive global default (100 requests / 15 minutes).
An authenticated (allowlisted) user could still create up to 100 pending `Domain`
rows in 15 minutes. Not a security hole (auth is required, and it's the same trust
boundary as any other allowlisted action), but it's an inconsistency with the
established per-route rate-limit pattern elsewhere in this phase.

**Fix:** Consider adding a `DOMAIN_CREATE_RATE_LIMIT` route-level override, mirroring
`VERIFY_RATE_LIMIT`'s shape, if unbounded row creation by a legitimate-but-careless
client becomes a concern.

### IN-02: `CNAME_TARGET`/`A_RECORD_IP` fallback literals are duplicated between `env.ts` and `domains.ts`

**File:** `apps/api/src/env.ts:67,72`, `apps/api/src/routes/domains.ts:103-107`

**Issue:** `computeVerificationTarget` re-declares the exact same fallback literals
(`"shortener.kurzly.local"`, `"0.0.0.0"`) that `env.ts`'s Zod schema defaults already
encode, reading directly from `process.env` instead of a validated/typed env object.
The header comment explains this is intentional (so behavior is identical whether or
not `loadEnv()` ran first, e.g. under Vitest), which is a reasonable tradeoff, but it
is a second source of truth for the same two literals — if one default is ever changed
without the other, the two boot paths (server.ts vs. under-test) would silently
diverge.

**Fix:** No change required for correctness today; consider exporting the schema's
parsed defaults (e.g. `envSchema.shape.CNAME_TARGET._def.defaultValue()`) or a small
shared constants module if this drifts again in a future phase.

---

_Reviewed: 2026-07-11T18:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
