# Phase 3: Domains & Multi-Domain TLS Routing - Research

**Researched:** 2026-07-11
**Domain:** Multi-tenant domain registration, DNS ownership verification, operator-delegated on-demand TLS gating, Host-header trust boundary
**Confidence:** MEDIUM (well-grounded in the existing codebase's established patterns; the Caddy/Traefik/DNS/Fastify-CVE findings are WebSearch-sourced against official docs/advisories, not Context7-verified)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 (TLS-Delivery — Scope-Neubewertung, löst den Phase-1-Konflikt):** TLS bleibt Betreiber-Sache (konsistent mit Phase-1 D-03/D-04). Kurzly baut **kein** in-app-ACME und terminiert kein TLS. **DOMAIN-03 wird umformuliert:** statt „System stellt automatisch Zertifikate aus" liefert Kurzly (a) den verifizierten Domain-Status und (b) einen leichten **`ask`-/Status-Endpoint** (z. B. `GET /api/tls-check?domain=<host>` → 200 wenn verifiziert & aktiv, sonst 404/403), den ein Betreiber-Reverse-Proxy mit **On-Demand-TLS** (Caddy `on_demand_tls.ask`, Traefik-certresolver o. ä.) abfragt, um Zertifikate **nur für verifizierte Domains** on-demand auszustellen. Kurzly **dokumentiert** dieses Muster (Erweiterung von `docs/deployment/reverse-proxy.md` aus Phase 1).
> Roadmap-/Requirements-Flag: DOMAIN-03 in REQUIREMENTS.md/ROADMAP.md sollte auf diese betreiber-delegierte Formulierung angepasst werden.

**D-02 (Domain-Typen & Verifizierung):** Unterstützt werden **beide**: **Subdomains via CNAME** (auf ein festes, dokumentiertes Ziel) **und Apex-Domains via A-Record** (feste dokumentierte IP) bzw. ALIAS. Die pro-Domain-Anleitung (DOMAIN-04) zeigt den je Typ korrekten Record.

**D-03 (DNS-Verifizierung):** DNS-Verifizierung per **on-demand „Jetzt prüfen"-Aktion** (DNS-Lookup des erwarteten CNAME-/A-Records) + Statusanzeige (ausstehend/aktiv/fehlgeschlagen). Periodischer Re-Check ist optional (Claude's Discretion). SSRF-/Missbrauchs-Schutz beim DNS-Check beachten (nur DNS-Auflösung, keine HTTP-Fetches gegen beliebige Hosts).

**D-04 (Autorisierung — nutzt den Phase-2-Kern):** Nur **owner/admin** dürfen Domains registrieren, verifizieren und löschen — über `requireDomainAccess(userId, domainId, 'admin')` bzw. beim Anlegen die Org/Team-Ownership; **member** nutzen Domains nur (nicht verwalten). Neu angelegte Domains werden der Org/dem Team des Erstellers zugeordnet.

### Claude's Discretion

DNS-Lookup-Umsetzung (Node `dns.resolveCname`/`resolve4`), exaktes Domain-Schema (erweitert die minimale `Domain` aus Phase 2 um `status`, `type` (subdomain/apex), `verificationTarget`/erwarteter Record, `verifiedAt`, Timestamps), genaue Signatur des `ask`-/Status-Endpoints, Caching/Rate-Limiting der DNS-Checks, UI-Details der Domain-Liste + Anleitung — Researcher/Planner auf Basis CLAUDE.md (Caddy/TLS- & SSRF-Research).

### Deferred Ideas (OUT OF SCOPE)

- **In-app-ACME / Kurzly als TLS-Terminator** — bewusst nicht (Betreiber-Delegation, Phase-1-konsistent).
- **Wildcard-Domains** und mehrere Domains pro Redirect-Ziel — spätere Bewertung.
- **Periodischer automatischer DNS-Re-Check** (statt nur on-demand) — optional, Discretion.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOMAIN-01 | Admin kann eine eigene Domain/Subdomain registrieren; sie wird mit Status „DNS ausstehend" angelegt | Pattern 1 (creation bootstraps its own ownership); extended `Domain` schema (Recommended Project Structure); `POST /api/domains` code example |
| DOMAIN-02 | Admin kann die DNS-Konfiguration (CNAME) einer Domain prüfen; bei Erfolg wechselt sie auf „Aktiv" | Pattern 2 (injectable DNS resolver); Code Examples' verify route; Pitfall 2 (enum migration), Pitfall 5 (DNS timeout) |
| DOMAIN-03 (reformuliert per D-01) | Kurzly liefert verifizierten Status + `ask`/Status-Endpoint, den der Betreiber-Proxy für On-Demand-TLS-Ausstellung abfragt (kein in-app-ACME) | Pattern 3 (Caddy `on_demand_tls.ask` wiring), Pattern 4 (Host-header resolution guard), Code Examples' `ask` endpoint, Pitfall 3 (ask-endpoint latency), Security Domain threat table |
| DOMAIN-04 | Admin sieht pro Domain die DNS-Anleitung (CNAME-Ziel bzw. A/ALIAS für Apex) | Don't Hand-Roll (apex/subdomain heuristic), Alternatives Considered (`psl` vs heuristic), `verificationTarget` field in schema recommendation |
</phase_requirements>

## Summary

Phase 3 extends the currently near-empty `Domain` model (today: just `id` + `createdAt`) into a full domain-lifecycle entity — hostname, type (subdomain/apex), status (pending/active/failed), the expected DNS record, and verification timestamps — and wires it into the Phase-2 `requireDomainAccess`/`scopedDomainIds` authorization core. Per locked decision D-01, Kurzly never touches TLS itself: it only tracks verified status and exposes a tiny `GET /api/tls-check?domain=<host>` "ask" endpoint that an operator-run Caddy (`on_demand_tls.ask`) or Traefik (via an operator-side polling script that materializes dynamic router config) queries before issuing a certificate. DNS verification is on-demand only (a "Jetzt prüfen" button), using Node's built-in `dns/promises` (`resolveCname` for subdomains, `resolve4`/apex for A-records) — no HTTP fetches are ever made to a domain, which is what keeps this SSRF-safe by construction.

The single largest non-obvious finding from this research is an **authorization bootstrapping gap**: `requireDomainAccess` needs an existing `DomainMembership` row, but *zero* such rows exist anywhere in the system today (Phase 2's `seedInitialAdmin` only creates a bare `User` row — see `apps/api/src/lib/admin-seed.ts`), and Phase 9 (Team Management/invites) hasn't shipped yet. This means **domain creation cannot be gated by `requireDomainAccess`** (there is no `domainId` yet to check against) — Phase 3 must instead grant domain creation to any authenticated (allowlisted) session, and atomically create an `owner`-role `DomainMembership` for the creator in the same transaction as the `Domain` row. Every *other* domain action (verify, view instructions, delete) then goes through `requireDomainAccess(prisma, userId, domainId, 'admin')` as D-04 specifies.

**Primary recommendation:** Extend `Domain` with `hostname` (unique), `type` (Prisma enum `subdomain|apex`), `status` (Prisma enum `pending|active|failed`), `verificationTarget`, `lastCheckedAt`, `lastCheckError`, `verifiedAt`, `updatedAt`; create it + its owning `DomainMembership` in one Prisma transaction; verify DNS via an injectable resolver module (mirroring the codebase's existing `canaryRoute(prisma)`/`authRoute(auth)` factory-injection pattern) so tests can stub DNS without monkey-patching Node's built-in module; expose `GET /api/tls-check?domain=<host>` as a pure read-only status lookup (200/403/404, no body leakage) rate-limited like the magic-link route; and build a small `resolveActiveDomainByHost(prisma, host)` helper now — used by the ask endpoint and reusable by Phase 5's redirect engine — to satisfy the Host-header-spoofing success criterion without hand-rolling per-route logic.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Domain registration + lifecycle status | API / Backend | Database | Prisma-persisted state machine (`pending→active/failed`); single source of truth the redirect engine and operator proxy both read |
| DNS ownership verification (on-demand check) | API / Backend | — | Server-side `dns/promises` lookup only; must never run in the browser (no client-side DNS API exists anyway) |
| `ask`/status endpoint for operator TLS | API / Backend | — | Pure read of `Domain.status`; consumed by an external process (Caddy/Traefik), not by Kurzly's own UI |
| Host-header → registered-domain resolution guard | API / Backend | — | Security-critical trust-boundary check; must live server-side ahead of any redirect/routing decision (Phase 5 reuses it) |
| Per-domain DNS setup instructions (copy CNAME/A) | Browser / Client | API / Backend | Static text templated from ENV-configured target + the domain's own `hostname`; API supplies the values, UI renders + copy-to-clipboard |
| Domain list, add-domain form, verify/delete actions | Browser / Client | API / Backend | Vue SPA screen (03-UI-SPEC.md); every action re-validated server-side via `requireDomainAccess` |
| Operator reverse-proxy TLS termination | Operator infrastructure (outside Kurzly) | — | D-01: explicitly NOT Kurzly's tier — Caddy/Traefik/nginx+certbot own this entirely |

## Standard Stack

### Core
No new runtime dependencies are required for this phase — Node's built-in `dns/promises` module (Node 24.x, already the project's pinned runtime) covers `resolveCname`/`resolve4`/`resolve` for both subdomain (CNAME) and apex (A) verification. This keeps the SSRF surface at zero: no HTTP client is added or used against operator-supplied domains.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:dns/promises` | Node 24.x builtin | CNAME/A record lookup for DNS ownership verification | Zero-dependency, no HTTP surface, already the runtime this Docker image ships (CLAUDE.md-pinned Node 24 LTS) [VERIFIED: Node.js official docs, `nodejs.org/api/dns.html`] |
| Prisma enum types (`DomainType`, `DomainStatus`) | bundled with `prisma@^7.8.0` (already installed) | Native Postgres enums for `type`/`status` on the extended `Domain` model | Matches the codebase's existing `Role` enum pattern in `schema.prisma` (defense-in-depth: invalid values can't be persisted at all) [VERIFIED: apps/api/prisma/schema.prisma, existing `enum Role`] |
| `@fastify/rate-limit` (already installed, ^11.1.0) | existing | Rate-limit the "Jetzt prüfen" verify action and the `ask` endpoint | Already used for `MAGIC_LINK_RATE_LIMIT`; reuse the identical route-level `config.rateLimit` mechanism (`apps/api/src/plugins/rateLimit.ts`) — no new package |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| — | — | — | No supporting libraries required — this phase deliberately has zero new npm dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled label-count heuristic for apex/subdomain UI pre-selection | `psl` (npm, Public-Suffix-List-based domain parser) | `psl` gives fully accurate `example.co.uk`-style multi-part-TLD classification; the hand-rolled heuristic can mis-preselect for exotic TLDs. Not worth adding a dependency here because D-02/UI-SPEC already make the type an **explicit, admin-overridable** field at creation time (the heuristic only pre-fills a toggle, never silently decides) — a wrong pre-fill is a one-click fix, not a correctness bug. Reconsider if support tickets show frequent misclassification. |
| Injectable DNS resolver module (custom, matches existing codebase pattern) | `vi.mock("node:dns/promises")` | Vitest CAN mock a Node builtin via `vi.mock`, but Node core modules' named exports are not always reconfigurable depending on module interop settings, and the codebase has an established, working precedent for exactly this shape of problem: `canaryRoute(prisma)` / `authRoute(auth)` are both plugin *factories* that accept the collaborator as a parameter instead of importing a singleton. Following that precedent (a small `dnsClient.ts` with an injectable resolver param) is safer/more consistent than introducing the codebase's first `vi.mock()` of a builtin module. |
| Caddy `on_demand_tls` `ask` endpoint (webhook, works out of the box) | Caddy `permission` module (Go plugin, `caddy-tls-permission-policy`) | The `ask` HTTP endpoint (documented, stable, language-agnostic) is the right fit for a self-hosted OSS tool whose operators may run any proxy — a custom compiled Caddy module would require operators to build a custom Caddy binary, which contradicts the "any reverse proxy, no lock-in" spirit of `docs/deployment/reverse-proxy.md`. |

**Installation:** None — no `npm install` needed this phase.

**Version verification:** N/A (no new packages).

## Package Legitimacy Audit

**No external packages are installed in this phase.** DNS verification uses Node's built-in `dns/promises` module; the operator-delegated TLS pattern (D-01) requires no Kurzly-side ACME/cert library at all. The Package Legitimacy Gate protocol is not applicable — this section is included per the template contract but has nothing to audit.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| *(none)* | — | — | — | — | — | N/A — no packages installed |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │              Vue SPA (Browser)           │
                         │  DomainsView.vue: list / add / verify /  │
                         │  delete / DNS-instructions accordion     │
                         └───────────────┬───────────────────────────┘
                                         │ fetch() /api/domains/*
                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          Fastify API (apps/api)                        │
│                                                                          │
│  POST /api/domains            requireSession → create Domain +         │
│                                owner DomainMembership (1 tx, no prior   │
│                                requireDomainAccess check possible)      │
│                                                                          │
│  POST /api/domains/:id/verify requireDomainAccess(minRole:'admin')     │
│         │                     → dnsClient.resolve(type, hostname)      │
│         │                     → compare against verificationTarget     │
│         ▼                     → update status/verifiedAt/lastCheckedAt │
│  ┌──────────────┐                                                      │
│  │ dnsClient.ts │  injectable resolver (dns/promises by default)       │
│  │ (SSRF-safe:  │  — CNAME lookup for subdomain, A lookup for apex —   │
│  │ DNS only,    │  NEVER opens an HTTP connection to the domain        │
│  │ no fetch)    │                                                      │
│  └──────────────┘                                                      │
│                                                                          │
│  GET /api/domains              scopedDomainIds → list caller's domains │
│  DELETE /api/domains/:id       requireDomainAccess(minRole:'admin')    │
│  GET /api/domains/:id/instructions → template CNAME/A from ENV target  │
│                                                                          │
│  GET /api/tls-check?domain=x   resolveActiveDomainByHost(prisma, host) │
│      (rate-limited, no       →  200 if status==='active', else 403/404 │
│       session required —     →  reused later by Phase 5's redirect     │
│       operator-proxy calls)     Host-header resolution                 │
└──────────────────────────┬───────────────────────────────────────────┘
                            │  Domain.status === 'active'?
                            ▼
              ┌─────────────────────────────────┐
              │  Operator reverse proxy          │
              │  (Caddy on_demand_tls.ask /      │
              │   Traefik dynamic file-provider) │
              │  — issues Let's Encrypt cert      │
              │    ONLY for domains the ask       │
              │    endpoint returns 200 for       │
              └─────────────────────────────────┘
```

### Recommended Project Structure
```
apps/api/src/
├── lib/
│   ├── authorization.ts        # EXISTING (Phase 2) — reused unmodified
│   ├── dnsClient.ts            # NEW — injectable CNAME/A resolver wrapper
│   └── domainResolution.ts     # NEW — resolveActiveDomainByHost(prisma, host)
├── routes/
│   ├── domains.ts              # NEW — POST/GET/DELETE /api/domains, verify, instructions
│   └── tlsCheck.ts             # NEW — GET /api/tls-check (operator-facing ask endpoint)
├── plugins/
│   └── rateLimit.ts            # EXTENDED — add VERIFY_RATE_LIMIT / TLS_CHECK_RATE_LIMIT consts
└── generated/prisma/            # regenerated after schema.prisma extension

apps/api/prisma/
└── schema.prisma                # EXTENDED — Domain model gains hostname/type/status/etc.

apps/api/test/
├── dnsClient.test.ts            # NEW — unit tests, injected fake resolver, no real DNS
├── domains.integration.test.ts  # NEW — real-Postgres CRUD/status-transition/authz tests
├── domainResolution.test.ts     # NEW — host-spoofing / unregistered-host rejection tests
└── tlsCheck.integration.test.ts # NEW — ask-endpoint status-code tests

apps/web/src/
├── views/DomainsView.vue        # NEW — replaces ComingSoonView for /domains (per 03-UI-SPEC.md)
└── api.ts                       # EXTENDED — domain CRUD/verify client functions

packages/shared/src/
└── index.ts                     # EXTENDED — full Domain DTO (hostname/type/status/etc.), replacing the Phase-2 placeholder comment

docs/deployment/reverse-proxy.md # EXTENDED — On-Demand TLS `ask` integration section (Caddy + Traefik)
```

### Pattern 1: Domain creation bootstraps its own ownership (resolves the authz chicken-and-egg gap)
**What:** `POST /api/domains` requires only a valid authenticated (allowlisted) session — NOT `requireDomainAccess`, since the domain doesn't exist yet. In the same Prisma transaction, create the `Domain` row and an `owner`-role `DomainMembership` row for `request.session.user.id`.
**When to use:** Exactly once, at domain creation. Every subsequent domain action (verify/instructions/delete/list-detail) uses `requireDomainAccess`/`scopedDomainIds` as normal, per D-04.
**Why this is necessary:** `requireDomainAccess` (apps/api/src/lib/authorization.ts) denies-by-default when no `DomainMembership` row exists — and per Phase 2's `admin-seed.ts` header comment, "no schema-level global admin flag is added" and the full invite/role model is deferred to Phase 9. Today exactly one `User` row exists in a fresh deployment (`INITIAL_ADMIN_EMAIL`) with **zero** `DomainMembership` rows anywhere. Without this pattern, the first domain could never be created by anyone.
**Example:**
```typescript
// Source: pattern derived from apps/api/src/lib/authorization.ts's own
// "deny-by-default, minRole checked against an EXISTING row" contract —
// there is no existing row to check at creation time, so creation itself
// is what establishes it.
app.post("/api/domains", async (request, reply) => {
  const userId = request.session.user.id; // session guard, not requireDomainAccess
  const { hostname, type } = parseCreateDomainBody(request.body);

  const domain = await prisma.$transaction(async (tx) => {
    const created = await tx.domain.create({
      data: {
        hostname,
        type,
        status: "pending",
        verificationTarget: computeVerificationTarget(type), // from ENV
      },
    });
    await tx.domainMembership.create({
      data: { userId, domainId: created.id, role: "owner" },
    });
    return created;
  });

  return reply.code(201).send(toDomainDto(domain));
});
```

### Pattern 2: Injectable DNS resolver (mirrors `canaryRoute(prisma)` / `authRoute(auth)`)
**What:** A `dnsClient.ts` module exporting a `DnsResolver` interface (`resolveCname`, `resolve4`) with a default implementation backed by `node:dns/promises`, and a `verifyDomain(hostname, type, target, resolver = defaultResolver)` function that accepts the resolver as a parameter.
**When to use:** Everywhere DNS verification happens — the verify route wires the real resolver in production; tests inject a fake resolver object.
**Example:**
```typescript
// Source: pattern matches apps/api/src/routes/canary.ts's canaryRoute(prisma)
// factory shape (Prisma client injected, not imported as a singleton) —
// same reasoning applied to the DNS resolver so tests never touch real DNS.
import * as dns from "node:dns/promises";

export type DnsResolver = {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
};

export const nodeDnsResolver: DnsResolver = {
  resolveCname: (h) => dns.resolveCname(h),
  resolve4: (h) => dns.resolve4(h),
};

export async function verifyDomain(
  hostname: string,
  type: "subdomain" | "apex",
  expectedTarget: string,
  resolver: DnsResolver = nodeDnsResolver,
): Promise<{ verified: boolean; error?: string }> {
  try {
    const records =
      type === "subdomain"
        ? await resolver.resolveCname(hostname)
        : await resolver.resolve4(hostname);
    const normalized = records.map((r) => r.toLowerCase().replace(/\.$/, ""));
    const target = expectedTarget.toLowerCase().replace(/\.$/, "");
    return { verified: normalized.includes(target) };
  } catch (err) {
    // ENOTFOUND / ENODATA are expected "not verified yet" outcomes, not
    // exceptional errors — surface as a structured failure, never throw
    // past this boundary (D-03: status stays 'pending' or flips 'failed').
    return { verified: false, error: (err as NodeJS.ErrnoException).code ?? "DNS_LOOKUP_FAILED" };
  }
}
```

### Pattern 3: Caddy `on_demand_tls.ask` wiring (docs/deployment/reverse-proxy.md addition)
**What:** Global Caddy option that queries Kurzly's status endpoint before every first-handshake cert issuance for an unrecognized hostname.
**When to use:** Documented for operators who chose the Caddy option in Phase 1's `reverse-proxy.md`.
**Example:**
```caddyfile
# Source: https://caddyserver.com/docs/caddyfile/options + on_demand_tls docs
{
    on_demand_tls {
        ask http://app:3000/api/tls-check
    }
}

# Wildcard site block: any Host Caddy doesn't already have a static site
# block for goes through on-demand issuance, gated by the ask endpoint.
:443 {
    tls {
        on_demand
    }
    reverse_proxy app:3000
}
```
`GET /api/tls-check?domain=<host>` — Caddy appends `?domain=<sni-hostname>` automatically; the endpoint must respond in low milliseconds (it's on the TLS handshake path) via an indexed `hostname` lookup, and must NOT redirect (Caddy does not follow redirects on this call).

### Pattern 4: Host-header resolution guard (shared with Phase 5)
**What:** A single `resolveActiveDomainByHost(prisma, host)` function that normalizes an incoming host string (lowercase, strip `:port`) and returns the matching `Domain` row **only if** `status === 'active'` — `null` for anything else (unregistered, pending, failed, malformed).
**When to use:** By `GET /api/tls-check` today; by Phase 5's redirect engine when it replaces the `routes/redirect.ts` stub. Building it now (even though the stub isn't wired to Host-header resolution yet) satisfies success criterion 4 without duplicating logic later.
**Example:**
```typescript
// Source: pattern follows apps/api/src/lib/authorization.ts's own
// deny-by-default contract — absence of an exact-match, active-status
// domain row is treated as denial, never as "match nearest"/wildcard.
export async function resolveActiveDomainByHost(
  prisma: PrismaClient,
  rawHost: string | undefined,
): Promise<Domain | null> {
  if (!rawHost) return null;
  const normalized = rawHost.toLowerCase().split(":")[0]?.trim();
  if (!normalized) return null;

  const domain = await prisma.domain.findUnique({ where: { hostname: normalized } });
  if (!domain || domain.status !== "active") return null;
  return domain;
}
```
Never read `request.hostname`/`X-Forwarded-Host` and treat it as pre-validated — always pass it through this exact-match lookup (see Pitfall 1 below on `trustProxy`/CVE-2026-3635).

### Anti-Patterns to Avoid
- **Fetching the domain's own HTTP endpoint to "double check" DNS:** Never issue an HTTP request to a user-supplied domain for any reason — this reintroduces the exact SSRF surface D-03 explicitly calls out avoiding. DNS resolution only.
- **Trusting `request.hostname` / raw `X-Forwarded-Host` for the `ask` endpoint's decision:** The `ask` endpoint takes `domain` as an explicit query parameter (Caddy sets this from the TLS SNI, not from a spoofable header) — always compare it via exact match against `Domain.hostname`, never substring/wildcard match, and never fall back to "first domain" on a miss.
- **Checking `requireDomainAccess` before the `Domain` row exists:** As covered in Pattern 1 — this is a bootstrapping order-of-operations bug, not a security hardening opportunity; getting this backwards either 500s on every domain creation or (worse) accidentally grants a workaround that skips the ownership-assignment transaction.
- **Storing the resolved DNS record without normalizing trailing dots/case:** `dig`-style CNAME responses are FQDN-with-trailing-dot and can vary in case; compare normalized forms (see Pattern 2) or verification will spuriously fail against a technically-correct DNS setup.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TLS certificate issuance/renewal | An in-app ACME client (e.g. `acme-client`) | Operator's own reverse proxy (Caddy/Traefik/certbot) | D-01 locked decision — Kurzly is explicitly not a CA client; this is a large, security-critical surface (private key handling, ACME challenge hosting, renewal scheduling) that a mature, widely-audited reverse proxy already solves correctly. |
| Public-suffix-aware apex/subdomain classification | A hand-rolled TLD list | Simple label-count heuristic (pre-fill only, user confirms) | See Alternatives Considered — correctness is not safety-critical here because the value is explicit and admin-overridable before submission. |
| DNS timeout/cancellation | Manual socket-level DNS client | `Promise.race([resolver.resolveX(host), timeoutPromise])` around the built-in resolver, OR `dns.promises.Resolver`'s `.cancel()` for a cleaner cancel path | Node's `dns.promises` functions don't accept a signal/timeout option natively; wrapping is the standard, low-risk approach — building a custom UDP DNS client from scratch would be a massive, unjustified undertaking for a "check now" button. |

**Key insight:** Every hand-roll temptation in this phase (ACME, TLD parsing, raw DNS protocol) has a mature, either operator-owned (ACME) or already-available (Node builtin DNS) solution — the actual net-new code surface for Phase 3 should be small: schema fields, one resolver wrapper, one host-resolution guard, and standard CRUD routes.

## Common Pitfalls

### Pitfall 1: Trusting `X-Forwarded-Host`/`request.hostname` without validation (Fastify CVE-2026-3635 context)
**What goes wrong:** Fastify's `request.protocol`/`request.host` getters can read `X-Forwarded-Proto`/`X-Forwarded-Host` from connections that bypass the trusted proxy entirely when `trustProxy` is configured as a restrictive function/IP/subnet (fixed in fastify 5.8.3+, GHSA-444r-cwp2-x5xf).
**Why it happens:** A misconfigured or overly-clever `trustProxy` setting (or code that reads these getters for security decisions without an explicit allowlist check) creates a header-spoofing path.
**How to avoid:** Kurzly's `apps/api/src/lib/env.ts` `TRUST_PROXY` is a plain boolean (not a restrictive function), and `fastify` is pinned `^5.10.0` (well past the 5.8.3 patch) [VERIFIED: apps/api/package.json] — so this specific CVE doesn't directly apply. Still: never use `request.hostname`/forwarded headers as the sole input to any security decision (Pattern 4's `resolveActiveDomainByHost` is the correct pattern — exact-match against the `Domain` table, deny-by-default on miss).
**Warning signs:** Any code path that does `if (someHeader === expectedDomain)` without going through the shared resolution helper, or that trusts a header to determine *which* domain's data to return.

### Pitfall 2: Enum migration ordering when a `NOT NULL` column has no default on an already-nonempty table
**What goes wrong:** Adding `hostname String @unique` (or `status DomainStatus`) as `NOT NULL` without a default fails the migration if any `Domain` rows already exist without values for that column.
**Why it happens:** Prisma's `migrate dev` generates a plain `ALTER TABLE ... ADD COLUMN ... NOT NULL` when there's no `@default`, which Postgres rejects against existing rows unless a default is supplied inline.
**How to avoid:** Since the `Domain` table today only ever contains ephemeral testcontainers rows (no real production Domain data exists — confirmed via `apps/api/test/authorization.test.ts`'s `prisma.domain.create({ data: {} })` calls), a straightforward additive migration is safe for this phase. If any manual/dev-seeded rows exist locally, either provide a Prisma `@default` for new required columns or clear the table before migrating. [CITED: prisma.io data-migration guide, "expand and contract" pattern — only strictly needed when live data already uses the changing shape]
**Warning signs:** `prisma migrate dev` failing with a `null value in column "hostname" violates not-null constraint` error.

### Pitfall 3: `ask` endpoint latency on the TLS handshake path
**What goes wrong:** If `GET /api/tls-check` does anything slow (unindexed query, N+1 lookup, calling out to another service), every *new* hostname's TLS handshake stalls for that duration — Caddy's docs are explicit that this endpoint sits directly on the handshake critical path.
**Why it happens:** Treating the ask endpoint like a normal API route instead of a hot-path lookup.
**How to avoid:** Single indexed `findUnique({ where: { hostname } })` (Prisma auto-indexes `@unique` columns), no joins, no external calls, return immediately. Already-issued certificates are cached by the proxy, so this only matters for the *first* handshake per hostname — but it must still be fast on that first hit. [CITED: caddyserver.com/docs/json/apps/tls/automation/on_demand/ask]
**Warning signs:** Slow first-load / intermittent handshake failures reported by operators immediately after adding a new domain.

### Pitfall 4: Rate-limiting the verify action too permissively or too strictly
**What goes wrong:** No rate limit lets a malicious/broken client hammer the DNS-check endpoint (external DNS query amplification against the operator's resolver, plus Postgres write load on every click); too strict a limit makes the legitimate "I just changed my DNS, let me check again in 30 seconds" UX (explicitly designed for in 03-UI-SPEC.md's 429 copy) feel broken.
**Why it happens:** Copy-pasting `MAGIC_LINK_RATE_LIMIT`'s very tight 5/15min without considering this is a much lower-risk, higher-frequency legitimate action.
**How to avoid:** A separate, more permissive per-route limit (e.g. `VERIFY_RATE_LIMIT = { max: 10, timeWindow: "5 minutes" }`, scoped per authenticated user or per domain, not just per IP) — following the exact `routes/auth.ts` pattern of registering a specific static route ahead of any wildcard, with `config: { rateLimit: VERIFY_RATE_LIMIT }`. Exact numbers are Claude's Discretion per D-03/CONTEXT.md — pick something materially looser than the magic-link limit and document the reasoning in the plan.
**Warning signs:** UAT reports of "I clicked check twice and got rate-limited" (too strict) or unexplained DNS-resolver load spikes (too loose).

### Pitfall 5: DNS lookup hangs with no timeout
**What goes wrong:** `dns.promises.resolveCname`/`resolve4` have no built-in timeout — a misbehaving/unreachable authoritative nameserver can leave the "Jetzt prüfe…" button spinning indefinitely (the UI-SPEC's `disabled, opacity:.6` loading state has no upper bound without one).
**Why it happens:** Node's `dns/promises` functions don't accept a signal/timeout option.
**How to avoid:** Wrap resolver calls in `Promise.race([resolver.resolveX(host), timeout(5000)])` inside `dnsClient.ts`; treat a timeout the same as a resolution failure (`verified: false, error: "DNS_TIMEOUT"`), never let it propagate as an unhandled route error.
**Warning signs:** A verify request that never resolves in integration tests, or hangs past Vitest's default test timeout.

## Code Examples

### Verify route wiring `requireDomainAccess` + injectable DNS + rate limit
```typescript
// Source: pattern composed from apps/api/src/routes/canary.ts (factory
// injection) + apps/api/src/routes/auth.ts (specific-route-before-wildcard
// rate-limit registration) + apps/api/src/lib/authorization.ts (authz call)
import { requireDomainAccess, ForbiddenError } from "../lib/authorization.js";
import { verifyDomain } from "../lib/dnsClient.js";
import { VERIFY_RATE_LIMIT } from "../plugins/rateLimit.js";

export function domainsRoute(prisma: PrismaClient) {
  return async function registerDomainsRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/domains/:id/verify",
      config: { rateLimit: VERIFY_RATE_LIMIT },
      handler: async (request, reply) => {
        const { id } = request.params as { id: string };
        try {
          await requireDomainAccess(prisma, request.session.user.id, id, "admin");
        } catch (err) {
          if (err instanceof ForbiddenError) return reply.code(403).send({ error: "Forbidden" });
          throw err;
        }

        const domain = await prisma.domain.findUniqueOrThrow({ where: { id } });
        const result = await verifyDomain(domain.hostname, domain.type, domain.verificationTarget);

        const updated = await prisma.domain.update({
          where: { id },
          data: {
            status: result.verified ? "active" : "failed",
            verifiedAt: result.verified ? new Date() : domain.verifiedAt,
            lastCheckedAt: new Date(),
            lastCheckError: result.verified ? null : (result.error ?? "DNS record not found"),
          },
        });

        return reply.send(toDomainDto(updated));
      },
    });
  };
}
```

### `ask` endpoint (no session required — operator proxy calls this)
```typescript
// Source: pattern follows Caddy's documented contract (2xx = allow,
// anything else = deny, no body needed) + this project's
// resolveActiveDomainByHost helper (Pattern 4)
export function tlsCheckRoute(prisma: PrismaClient) {
  return async function registerTlsCheckRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/tls-check",
      config: { rateLimit: TLS_CHECK_RATE_LIMIT },
      handler: async (request, reply) => {
        const { domain } = request.query as { domain?: string };
        const resolved = await resolveActiveDomainByHost(prisma, domain);
        if (!resolved) return reply.code(404).send();
        return reply.code(200).send();
      },
    });
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| In-app ACME clients bundled into SaaS-style multi-tenant products (Vercel/Netlify-style automatic custom-domain TLS) | Operator-delegated on-demand TLS via reverse-proxy `ask` hooks (Caddy) or dynamic-config file providers (Traefik) | Established pattern for years in self-hosted OSS (matches Coolify/Dokploy-style architectures per this research's Traefik findings) | Kurzly deliberately opts OUT of the SaaS pattern per D-01 — smaller attack surface, no private-key custody, no ACME rate-limit management burden on Kurzly itself |
| Caddy `on_demand_tls` `interval`/`burst` inline rate-limit options | Caddy `permission` module for issuance rate/access control | Deprecated in recent Caddy releases per this research's WebSearch findings | Not directly relevant to Kurzly's own `ask` endpoint design (Kurzly doesn't run Caddy itself), but worth a one-line note in the `reverse-proxy.md` doc update so operators don't copy deprecated config |

**Deprecated/outdated:**
- Caddy's `on_demand_tls { interval ... burst ... }` config block: deprecated in favor of the `permission` module — the docs update in this phase should show the `ask`-only form (Pattern 3) without `interval`/`burst`, since Kurzly's `ask` endpoint is itself the authoritative gate.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Domain creation should be gated by "any authenticated (allowlisted) session" rather than any pre-existing role, with the creator becoming `owner` via a transactional `DomainMembership` insert. | Pattern 1, Summary | If the intended model is actually "only the seeded `INITIAL_ADMIN_EMAIL` user may create domains" (a global-admin concept not yet modeled in the schema), this pattern would be too permissive once Phase 9's invite flow adds more users before any global-role concept exists. Low practical risk today since Phase 9 (invites) hasn't shipped, so exactly one user can log in — but the planner should confirm this reading against D-04's intent before implementation. |
| A2 | `VERIFY_RATE_LIMIT` and `TLS_CHECK_RATE_LIMIT` exact thresholds (proposed `10/5min` and a generous per-IP limit respectively) — Claude's Discretion per CONTEXT.md, not derived from an authoritative source. | Pitfall 4, Code Examples | Too loose: minor DNS-amplification/load risk. Too strict: UAT friction on the documented "check again shortly" UX. Either is a cheap post-launch tuning fix, not a redesign. |
| A3 | Simple label-count heuristic (no `psl` package) is sufficient for the UI's apex/subdomain auto-preselect, since the actual `type` value is admin-confirmed before submission. | Alternatives Considered, Don't Hand-Roll | If many operators use multi-part-TLD domains (`.co.uk`, `.com.au`) and find the pre-fill wrong often enough to be annoying, adding `psl` later is a small, low-risk addition — not a correctness or security risk either way since the value is always explicit. |
| A4 | Traefik has no direct "ask webhook" primitive equivalent to Caddy's `on_demand_tls.ask`; the documented pattern is an operator-side script polling Kurzly's status endpoint to materialize dynamic router config. | Pattern 3 discussion, State of the Art | This is WebSearch-derived (MEDIUM confidence), not Context7/official-docs-verified in depth. If Traefik has since added a native ask-style webhook, the `reverse-proxy.md` doc update should reference it directly instead of the polling-script workaround — worth a final doc-writing-time check against `doc.traefik.io`. |

## Open Questions

1. **Does D-04's "Org/Team-Ownership" language imply a future multi-tenant Organization model beyond the current flat `User → DomainMembership → Domain` shape?**
   - What we know: The current schema has no `Organization`/`Team` entity at all — `DomainMembership` directly ties a `User` to a `Domain` with a role. Phase 9 is titled "Team Management" but its requirements (TEAM-01..06) describe inviting users with a role and assigning them to specific domains — still domain-scoped, not org-scoped.
   - What's unclear: Whether "Org/Team des Erstellers" in D-04 is just informal language for "the creator's own domain-scoped ownership" (my reading, per Pattern 1) or hints at a future Organization layer this phase should leave room for.
   - Recommendation: Proceed with Pattern 1 (creator becomes the new domain's sole `owner`) — it's consistent with every other artifact in the repo (schema, ROADMAP Phase 9 description, admin-seed.ts comments) and doesn't block a future Organization layer, since it would only ever need an additive migration on top.

2. **Should the "Fehlgeschlagen" (failed) status auto-revert to "pending" on a subsequent verify attempt, or stay "failed" until success?**
   - What we know: 03-UI-SPEC.md explicitly supports both badge states and defers the exact transition to "Planner/Executor... anhand D-03" (UI-SPEC line 318).
   - What's unclear: Whether a domain that was ever "failed" should display differently from one that's simply still "pending" (never checked), for audit/debugging purposes.
   - Recommendation: Keep `status` as `pending → active` (never-failed path) or `pending → failed → active` (has-failed-before path) — i.e. a failed check sets `status: 'failed'`, and a subsequent *successful* check moves straight to `'active'`; a subsequent *unsuccessful* recheck stays `'failed'`. This preserves the most information for the UI's "Zuletzt geprüft" error line without needing a separate `everFailed` flag.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node:dns/promises` | DNS verification | ✓ (Node builtin) | Node 24.x (project-pinned) | — |
| PostgreSQL (via testcontainers) | Domain CRUD/status integration tests | ✓ (existing harness) | `postgres:18-alpine` | — |
| Real external DNS resolution (live internet) | Manual/E2E verification of the actual verify flow against a real domain | Not verifiable in this research session (sandboxed) | — | Tests must stub the resolver (Pattern 2); do not depend on live DNS in CI |
| Caddy / Traefik (operator's own infra) | Consuming the `ask` endpoint | Not installed in this repo/environment — by design (D-01, operator's own infra) | — | Documentation-only deliverable (`docs/deployment/reverse-proxy.md` update); no code in this repo talks to a real proxy |

**Missing dependencies with no fallback:** none — nothing in this phase's actual deliverable requires an unavailable tool.

**Missing dependencies with fallback:** Live DNS/live reverse-proxy testing is out of this repo's automated-test scope by design; covered via resolver injection + documentation instead.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.10 (existing, `apps/api/vitest.config.ts`) |
| Config file | `apps/api/vitest.config.ts` — real-Postgres testcontainers harness (`globalSetup.ts` + `setupFileEach.ts`, BEGIN/ROLLBACK per test) |
| Quick run command | `pnpm --filter @kurzly/api test -- test/domains.integration.test.ts` |
| Full suite command | `pnpm -r test` (repo-root script, runs every workspace's Vitest suite) |

### Phase Requirement → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOMAIN-01 | Admin registers a domain/subdomain → created with status "pending" | integration (real Postgres) | `pnpm --filter @kurzly/api test -- test/domains.integration.test.ts` | ❌ Wave 0 |
| DOMAIN-02 | Admin triggers DNS check → correct CNAME/A flips to "Active", incorrect leaves it pending/failed | unit (`dnsClient.ts`, injected fake resolver) + integration (verify route, real Postgres, fake resolver injected via `buildApp`) | `pnpm --filter @kurzly/api test -- test/dnsClient.test.ts test/domains.integration.test.ts` | ❌ Wave 0 |
| DOMAIN-03 (reformulated per D-01) | Only "Active" domains pass the `ask`/tls-check endpoint (200); pending/failed/unregistered do not (403/404) | integration (real Postgres, `fastify.inject`) | `pnpm --filter @kurzly/api test -- test/tlsCheck.integration.test.ts` | ❌ Wave 0 |
| DOMAIN-04 | Admin sees correct per-domain DNS instructions (CNAME for subdomain, A/ALIAS for apex) | unit/integration (instructions endpoint or DTO builder) | `pnpm --filter @kurzly/api test -- test/domains.integration.test.ts` | ❌ Wave 0 |
| Success Criterion 4 (Host-header spoofing rejection) | `resolveActiveDomainByHost` rejects unregistered/spoofed/pending hosts, only resolves exact-match `active` domains | unit (no DB needed for pure-function cases) + integration (real Postgres) | `pnpm --filter @kurzly/api test -- test/domainResolution.test.ts` | ❌ Wave 0 |
| D-04 (authorization) | Non-owner/admin member cannot verify/delete a domain they don't have `admin`+ access to; deny-by-default for unknown domain | integration (real Postgres, reuses `requireDomainAccess` — already unit-tested in Phase 2) | `pnpm --filter @kurzly/api test -- test/domains.integration.test.ts` | ❌ Wave 0 |
| SSRF-safety canary | Verifying a domain never issues an HTTP request — only DNS resolution | unit (assert the injected fake resolver's DNS methods are called, and no `fetch`/`http` call happens — can spy on global `fetch` and assert zero calls during a verify) | `pnpm --filter @kurzly/api test -- test/dnsClient.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @kurzly/api test -- <touched test file>`
- **Per wave merge:** `pnpm -r test` (full suite, matches CI's fast test job from Phase 1's `01-09-PLAN.md`)
- **Phase gate:** Full suite green (`pnpm -r test` + `pnpm -r exec tsc --noEmit`) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/api/test/dnsClient.test.ts` — covers DOMAIN-02, SSRF-safety canary
- [ ] `apps/api/test/domains.integration.test.ts` — covers DOMAIN-01, DOMAIN-02, DOMAIN-04, D-04 authz
- [ ] `apps/api/test/tlsCheck.integration.test.ts` — covers DOMAIN-03 (reformulated)
- [ ] `apps/api/test/domainResolution.test.ts` — covers Success Criterion 4
- [ ] Prisma migration for extended `Domain` model + new enums — needed before any of the above can run against real schema
- [ ] `packages/shared/src/index.ts` — extend `Domain` DTO (currently a Phase-2 placeholder comment) so `apps/web` gets typed domain fields

*(Framework itself: no gap — Vitest + testcontainers harness from Phase 1 already covers everything this phase needs; only new test files are missing.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (indirect) | Reuses Phase 2's better-auth session cookie — no new auth surface added |
| V3 Session Management | no | No changes to session handling this phase |
| V4 Access Control | yes | `requireDomainAccess(minRole:'admin')` for verify/delete/instructions; deny-by-default per existing Phase 2 core; Pattern 1's creation-bootstrap is the one deliberate, documented exception |
| V5 Input Validation | yes | Zod (already a dependency, `^4.4.3`) schema for the domain hostname (RFC-1123 hostname format, length limits, no wildcard/scheme prefix) and `type` enum on `POST /api/domains` |
| V6 Cryptography | no | No cryptographic operations added this phase (TLS is explicitly out of scope per D-01) |
| V13 API/Web Service (host/header trust) | yes | Never trust `X-Forwarded-Host`/`request.hostname` for domain resolution — always exact-match against `Domain.hostname` via `resolveActiveDomainByHost` (Pattern 4), deny on any miss |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via domain verification (fetching an attacker-controlled URL under the guise of "checking DNS") | Tampering / Elevation of Privilege | DNS-resolution-only verification (`dns/promises`, never `fetch`/`http.request` against the domain) — see Don't Hand-Roll, Anti-Patterns |
| Host-header / `X-Forwarded-Host` spoofing to hijack the `ask` endpoint's decision or (in Phase 5) redirect resolution | Spoofing | `resolveActiveDomainByHost` exact-match against the `Domain` table; deny-by-default on any non-`active`/unregistered host; never derive the "which domain" decision from a raw forwarded header without this lookup |
| Domain-hijacking via DNS record reuse (an operator abandons a subdomain, its DNS still points at Kurzly's target, a new registrant could claim it in Kurzly without owning the DNS) | Spoofing / Elevation of Privilege | Standard for this class of product (matches how Vercel/Netlify/Cloudflare Pages handle custom domains) — mitigated by requiring an ACTIVE, freshly-passing DNS check at claim time; deleting a domain in Kurzly should be considered for automatically reverting its status so a stale CNAME can't be silently re-claimed without a fresh check (worth a plan-time note, not a blocking issue for MVP) |
| Rate-limit bypass on the verify action to cause DNS-amplification load against the operator's resolver | Denial of Service | Per-route `@fastify/rate-limit` config (Pitfall 4), scoped tighter than the global default but looser than the magic-link limit |
| Enumerable `ask` endpoint used to fingerprint which domains exist on an instance | Information Disclosure | 200/403/404 only, no response body, no distinguishing timing between "domain doesn't exist" vs "domain exists but not active" beyond the status code itself (per CONTEXT.md's "kein Ziel-URL-Leak" specific idea) |

## Sources

### Primary (HIGH confidence)
- `apps/api/prisma/schema.prisma`, `apps/api/src/lib/authorization.ts`, `apps/api/src/lib/admin-seed.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/canary.ts`, `apps/api/src/routes/redirect.ts`, `apps/api/src/lib/env.ts`, `apps/api/src/plugins/rateLimit.ts`, `apps/api/src/plugins/cors.ts`, `apps/api/test/authorization.test.ts`, `apps/api/test/globalSetup.ts`, `apps/api/vitest.config.ts`, `packages/shared/src/index.ts`, `docs/deployment/reverse-proxy.md` — direct codebase inspection, this session
- GHSA-444r-cwp2-x5xf / CVE-2026-3635 (fastify request.host/protocol spoofing advisory) — `github.com/fastify/fastify/security/advisories/GHSA-444r-cwp2-x5xf` — cross-checked against `apps/api/package.json`'s pinned `fastify@^5.10.0` (patched)

### Secondary (MEDIUM confidence)
- Caddy `on_demand_tls`/`ask` official docs — `caddyserver.com/docs/json/apps/tls/automation/on_demand/ask/`, `caddyserver.com/docs/caddyfile/directives/tls`, `caddyserver.com/docs/automatic-https`
- Traefik certificate resolver docs — `doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/`
- Node.js `dns` module docs — `nodejs.org/api/dns.html`
- Prisma data-migration / expand-and-contract guide — `prisma.io/docs/guides/database/data-migration`
- OWASP SSRF Prevention in Node.js — `owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs`
- `psl` npm package README — `npmjs.com/package/psl`

### Tertiary (LOW confidence)
- Traefik "no native ask webhook" characterization (Assumption A4) — synthesized from WebSearch results describing file/HTTP dynamic-config providers, not a direct Traefik docs statement that no ask-style primitive exists; flagged for a final check at doc-writing time.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, entirely built on Node builtins + already-installed/verified packages from CLAUDE.md
- Architecture: HIGH — directly derived from established, working codebase patterns (factory injection, requireDomainAccess, rate-limit registration)
- Pitfalls: MEDIUM — DNS/Caddy/Traefik/CVE findings are WebSearch-sourced against official docs/advisories (not Context7-cross-verified), cross-checked once each against a primary source URL

**Research date:** 2026-07-11
**Valid until:** 2026-08-10 (30 days — stable domain: DNS protocol semantics, Prisma enum migration behavior, and Caddy/Traefik on-demand-TLS patterns change slowly; re-verify the Fastify CVE fix-version note and Traefik ask-webhook assumption if this research is reused past that window)
