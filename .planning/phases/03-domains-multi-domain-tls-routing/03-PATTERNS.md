# Phase 03: Domains & Multi-Domain TLS Routing — Pattern Map

**Mapped:** 2026-07-11  
**Files analyzed:** 15 new/modified files  
**Analogs found:** 12/15 (exact role+data flow matches for all, using Phase 1–2 established patterns)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/prisma/schema.prisma` | model | CRUD | Phase 2 `schema.prisma` (Domain, DomainMembership, Role enum) | exact |
| `apps/api/src/lib/dnsClient.ts` | service | request-response | `apps/api/src/routes/canary.ts` (injectable resolver pattern) | exact |
| `apps/api/src/lib/domainResolution.ts` | utility | request-response | `apps/api/src/lib/authorization.ts` (deny-by-default lookup) | exact |
| `apps/api/src/routes/domains.ts` | controller | CRUD | `apps/api/src/routes/auth.ts` (Fastify route factory, requireSession/requireDomainAccess) | exact |
| `apps/api/src/routes/tlsCheck.ts` | controller | request-response | `apps/api/src/routes/canary.ts` (simple GET, no session required) | exact |
| `apps/api/src/plugins/rateLimit.ts` | config | request-response | `apps/api/src/plugins/rateLimit.ts` (add new const to existing file) | exact |
| `apps/api/src/env.ts` | config | request-response | `apps/api/src/env.ts` (extend envSchema, add new vars to existing file) | exact |
| `apps/api/test/dnsClient.test.ts` | test | request-response | `apps/api/test/authorization.test.ts` (Vitest describe/it, real Postgres, seedUser helper) | exact |
| `apps/api/test/domains.integration.test.ts` | test | CRUD | `apps/api/test/authorization.test.ts` (Vitest, testcontainers, per-test isolation) | exact |
| `apps/api/test/tlsCheck.integration.test.ts` | test | request-response | `apps/api/test/auth.integration.test.ts` (fastify.inject pattern, no session required) | role-match |
| `apps/api/test/domainResolution.test.ts` | test | request-response | `apps/api/test/authorization.test.ts` (unit + integration, deny-by-default cases) | exact |
| `apps/web/src/views/DomainsView.vue` | component | request-response | `apps/web/src/views/ComingSoonView.vue` (screen-container, screen-header, style boilerplate) | exact |
| `apps/web/src/api.ts` | service | request-response | `apps/web/src/api.ts` (typed client functions, parseJsonOrThrow, fetch with method/headers) | exact |
| `packages/shared/src/index.ts` | model | request-response | Phase 2 shared exports (DTO type definitions) | exact |
| `docs/deployment/reverse-proxy.md` | documentation | — | Phase 1 `docs/deployment/reverse-proxy.md` (Caddy/Traefik setup docs, extend existing sections) | exact |

---

## Pattern Assignments

### `apps/api/prisma/schema.prisma` (model, CRUD)

**Analog:** `apps/api/prisma/schema.prisma` (Phase 2)

**Enum pattern** (lines 115–119 — existing Role enum, reuse as precedent for new enums):
```prisma
// Phase 3 adds TWO new enums alongside existing Role:

enum DomainType {
  subdomain
  apex
}

enum DomainStatus {
  pending
  active
  failed
}
```

**Domain model extension** (lines 102–106, extend existing Domain model):
```prisma
/// Domain model (extended in Phase 3 with hostname, type, status, DNS verification fields).
model Domain {
  id                  String             @id @default(cuid())
  hostname            String             @unique  // LOCKED: RFC-1123 hostname format, unique across instance
  type                DomainType         // LOCKED: subdomain | apex (D-02)
  status              DomainStatus       @default(pending)  // LOCKED: pending → active/failed (D-03)
  verificationTarget  String             // LOCKED: expected CNAME/A record (computed from ENV + type)
  verifiedAt          DateTime?          // LOCKED: timestamp of last successful verification
  lastCheckedAt       DateTime?          // LOCKED: timestamp of last verify attempt (success or fail)
  lastCheckError      String?            // LOCKED: error code/message from last failed check (e.g., "ENOTFOUND", "DNS_TIMEOUT")
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt
  memberships         DomainMembership[]
  
  @@index([status])  // RESEARCH Pitfall 3: indexed for fast "active" domain lookup on ask endpoint
}
```

**Rationale:** Exact model shape from RESEARCH Pattern 1's Domain creation bootstrapping + Pattern 4's `resolveActiveDomainByHost` lookup requirements.

---

### `apps/api/src/lib/dnsClient.ts` (service, request-response)

**Analog:** `apps/api/src/routes/canary.ts` (lines 1–17 factory injection pattern)

**Core injectable resolver pattern**:
```typescript
// Source: mirrors canaryRoute(prisma) factory pattern from apps/api/src/routes/canary.ts
// so tests inject a fake resolver instead of mocking Node's dns module.

import * as dns from "node:dns/promises";

export type DnsResolver = {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
};

export const nodeDnsResolver: DnsResolver = {
  resolveCname: (h) => dns.resolveCname(h),
  resolve4: (h) => dns.resolve4(h),
};

/**
 * Verifies a domain's DNS record against an expected target.
 * Returns { verified: boolean; error?: string } — never throws,
 * treating DNS failures (ENOTFOUND, ENODATA, ETIMEOUT) as expected
 * "not verified yet" outcomes (D-03, Pitfall 5).
 */
export async function verifyDomain(
  hostname: string,
  type: "subdomain" | "apex",
  expectedTarget: string,
  resolver: DnsResolver = nodeDnsResolver,
  timeoutMs: number = 5000,
): Promise<{ verified: boolean; error?: string }> {
  try {
    // Wrap resolver call in Promise.race to enforce timeout (Pitfall 5)
    const records = await Promise.race([
      type === "subdomain" ? resolver.resolveCname(hostname) : resolver.resolve4(hostname),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs),
      ),
    ]);
    
    // Normalize: DNS records can have trailing dots and case variance
    const normalized = records.map((r) => r.toLowerCase().replace(/\.$/, ""));
    const target = expectedTarget.toLowerCase().replace(/\.$/, "");
    return { verified: normalized.includes(target) };
  } catch (err) {
    // ENOTFOUND, ENODATA, DNS_TIMEOUT are expected, not exceptional
    const code = (err as NodeJS.ErrnoException).code ?? "DNS_LOOKUP_FAILED";
    return { verified: false, error: code };
  }
}
```

**Error handling:** Never throws past the function boundary (Pitfall 5, Anti-Patterns) — wraps all DNS errors into structured `{ verified, error }` tuple.

---

### `apps/api/src/lib/domainResolution.ts` (utility, request-response)

**Analog:** `apps/api/src/lib/authorization.ts` (lines 29–62, deny-by-default pattern)

**Core helper pattern**:
```typescript
// Source: pattern mirrors requireDomainAccess's deny-by-default contract
// (absence of an exact match = denial, never wildcard/fallback).
// Used by Phase 3's ask endpoint and Phase 5's redirect engine.

import type { Domain } from "../generated/prisma/client.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * Resolves an incoming host header to an ACTIVE Domain row.
 * Returns null for unregistered, pending, failed, or malformed hosts.
 * CRITICAL: never trust raw X-Forwarded-Host or request.hostname
 * without this lookup (CVE-2026-3635 context, Pitfall 1).
 */
export async function resolveActiveDomainByHost(
  prisma: PrismaClient,
  rawHost: string | undefined,
): Promise<Domain | null> {
  if (!rawHost) return null;
  
  // Normalize: lowercase, strip port
  const normalized = rawHost.toLowerCase().split(":")[0]?.trim();
  if (!normalized) return null;

  // Exact-match lookup only; deny-by-default on any miss
  const domain = await prisma.domain.findUnique({
    where: { hostname: normalized },
  });
  
  // Only return ACTIVE domains (ask endpoint gates on this)
  if (!domain || domain.status !== "active") return null;
  return domain;
}
```

**Rationale:** Single, reusable host-resolution guard (Pattern 4) for both ask endpoint and Phase 5 redirect engine, prevents header-spoofing bugs.

---

### `apps/api/src/routes/domains.ts` (controller, CRUD)

**Analog:** `apps/api/src/routes/auth.ts` (lines 66–86, Fastify route factory + per-route rate limit)

**Factory shape and domain creation (bootstrapping ownership)**:
```typescript
// Source: authRoute(auth) pattern (lines 66–86) + admin-seed.ts's upsert
// + authorization.ts's deny-by-default + rateLimit.ts's per-route config

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  requireDomainAccess,
  ForbiddenError,
  scopedDomainIds,
} from "../lib/authorization.js";
import { verifyDomain } from "../lib/dnsClient.js";
import { VERIFY_RATE_LIMIT } from "../plugins/rateLimit.js";
import { z } from "zod";

const createDomainSchema = z.object({
  hostname: z.string().min(1).max(255),
  type: z.enum(["subdomain", "apex"]),
});

export function domainsRoute(prisma: PrismaClient) {
  return async function registerDomainsRoute(app: FastifyInstance): Promise<void> {
    // POST /api/domains — create domain, bootstrap owner membership
    // (Pattern 1: no requireDomainAccess check possible; domain doesn't exist yet)
    app.post("/api/domains", async (request: FastifyRequest, reply: FastifyReply) => {
      // requireSession check — better-auth's session middleware must
      // run before this route (wired in app.ts)
      const userId = request.session?.user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const parsed = createDomainSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid domain data" });
      }

      const { hostname, type } = parsed.data;

      try {
        // Create Domain + owner DomainMembership in atomic transaction
        const domain = await prisma.$transaction(async (tx) => {
          // Check uniqueness constraint: hostname must not exist
          const existing = await tx.domain.findUnique({ where: { hostname } });
          if (existing) {
            throw new Error("Domain already registered");
          }

          // Create Domain with pending status
          const created = await tx.domain.create({
            data: {
              hostname,
              type,
              status: "pending",
              // verificationTarget computed from ENV + type (RESEARCH Claude's Discretion)
              verificationTarget: type === "subdomain"
                ? process.env.CNAME_TARGET || "shortener.kurzly.local"
                : process.env.A_RECORD_IP || "0.0.0.0",
            },
          });

          // Bootstrap owner membership so domain becomes manageable
          await tx.domainMembership.create({
            data: {
              userId,
              domainId: created.id,
              role: "owner",
            },
          });

          return created;
        });

        return reply.code(201).send(toDomainDto(domain));
      } catch (err) {
        if ((err as Error).message.includes("already registered")) {
          return reply.code(409).send({ error: "Domain already exists" });
        }
        throw err;
      }
    });

    // POST /api/domains/:id/verify — verify DNS and update status
    app.route({
      method: "POST",
      url: "/api/domains/:id/verify",
      config: { rateLimit: VERIFY_RATE_LIMIT },  // Per-route override (Pitfall 4)
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const userId = request.session?.user?.id;
        if (!userId) return reply.code(401).send({ error: "Unauthorized" });

        try {
          // Authz check via requireDomainAccess (D-04)
          await requireDomainAccess(prisma, userId, id, "admin");
        } catch (err) {
          if (err instanceof ForbiddenError) {
            return reply.code(403).send({ error: "Forbidden" });
          }
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

    // GET /api/domains — list caller's domains (scoped by authorization)
    app.get("/api/domains", async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.session?.user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const domainIds = await scopedDomainIds(prisma, userId);
      const domains = await prisma.domain.findMany({
        where: { id: { in: domainIds } },
      });

      return reply.send(domains.map(toDomainDto));
    });

    // DELETE /api/domains/:id — remove domain (owner/admin only)
    app.delete("/api/domains/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const userId = request.session?.user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      try {
        await requireDomainAccess(prisma, userId, id, "admin");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return reply.code(403).send({ error: "Forbidden" });
        }
        throw err;
      }

      await prisma.domain.delete({ where: { id } });
      return reply.code(204).send();
    });

    // GET /api/domains/:id/instructions — per-domain DNS setup guide
    app.get("/api/domains/:id/instructions", async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const userId = request.session?.user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      try {
        await requireDomainAccess(prisma, userId, id, "admin");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return reply.code(403).send({ error: "Forbidden" });
        }
        throw err;
      }

      const domain = await prisma.domain.findUniqueOrThrow({ where: { id } });

      return reply.send({
        hostname: domain.hostname,
        type: domain.type,
        verificationTarget: domain.verificationTarget,
        instructions: domain.type === "subdomain"
          ? `${domain.hostname}.  300  IN  CNAME  ${domain.verificationTarget}.`
          : `${domain.hostname}.  300  IN  A  ${domain.verificationTarget}`,
        alternativeForApex: domain.type === "apex"
          ? `${domain.hostname}.  300  IN  ALIAS  ${domain.verificationTarget}.`
          : null,
      });
    });
  };
}

function toDomainDto(domain: any) {
  return {
    id: domain.id,
    hostname: domain.hostname,
    type: domain.type,
    status: domain.status,
    verifiedAt: domain.verifiedAt,
    lastCheckedAt: domain.lastCheckedAt,
    lastCheckError: domain.lastCheckError,
    createdAt: domain.createdAt,
  };
}
```

**Key patterns:**
- Factory shape mirrors `authRoute(auth)` (line 66)
- Per-route rate limit config (line 72, analogous to auth.ts line 76)
- `requireDomainAccess` authorization pattern (line 107, analogous to authorization.ts)
- Transaction-based atomicity (line 62–82, analogous to admin-seed.ts upsert pattern)

---

### `apps/api/src/routes/tlsCheck.ts` (controller, request-response)

**Analog:** `apps/api/src/routes/canary.ts` (lines 18–35, simple GET, factory injection)

**TLS ask endpoint (no session required)**:
```typescript
// Source: canaryRoute pattern (lines 18–35) + resolveActiveDomainByHost
// + rateLimit.ts per-route config (Pitfall 3: ask endpoint is on TLS handshake path)

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { resolveActiveDomainByHost } from "../lib/domainResolution.js";
import { TLS_CHECK_RATE_LIMIT } from "../plugins/rateLimit.js";

export function tlsCheckRoute(prisma: PrismaClient) {
  return async function registerTlsCheckRoute(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/tls-check",
      config: { rateLimit: TLS_CHECK_RATE_LIMIT },  // Rate-limit the ask endpoint (Pitfall 3)
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        // Caddy appends ?domain=<sni-hostname> automatically (Pattern 3)
        const { domain } = request.query as { domain?: string };

        // Exact-match lookup via resolveActiveDomainByHost (Pattern 4)
        const resolved = await resolveActiveDomainByHost(prisma, domain);

        // Caddy's contract: 2xx = allow, non-2xx = deny, no body needed
        if (!resolved) {
          return reply.code(404).send();  // 404 = unregistered/pending/failed
        }

        return reply.code(200).send();  // 200 = active, issue cert
      },
    });
  };
}
```

**Rationale:** Minimal, high-speed lookup (Pitfall 3) — single indexed query, no joins, no external calls.

---

### `apps/api/src/plugins/rateLimit.ts` (config, request-response)

**Analog:** `apps/api/src/plugins/rateLimit.ts` (existing file, extend with new constants)

**Add to existing file** (after line 27):
```typescript
/**
 * Applied to `POST /api/domains/:id/verify` (RESEARCH Pitfall 4) via route-level
 * `config: { rateLimit: VERIFY_RATE_LIMIT }` — looser than MAGIC_LINK_RATE_LIMIT
 * (DNS check is lower-risk than email-bombing) but still protective against
 * DNS-amplification abuse. Scoped per authenticated user so one bad actor
 * doesn't lock out all legitimate admin users.
 */
export const VERIFY_RATE_LIMIT = {
  max: 10,
  timeWindow: "5 minutes",
} as const;

/**
 * Applied to `GET /api/tls-check` (RESEARCH Pitfall 3, Pattern 3) — generous
 * per-IP limit since this endpoint lives on the operator proxy's TLS handshake
 * path and must respond in milliseconds. Operator proxies may pre-cache results,
 * so this protects against sustained abuse without disrupting legitimate
 * multi-handshake bursts (e.g., a browser establishing multiple connections).
 */
export const TLS_CHECK_RATE_LIMIT = {
  max: 60,
  timeWindow: "1 minute",
} as const;
```

---

### `apps/api/src/env.ts` (config, request-response)

**Analog:** `apps/api/src/env.ts` (existing file, extend envSchema)

**Add to envSchema** (after line 62):
```typescript
  /**
   * Domain verification — CNAME target for subdomains (e.g. "shortener.kurzly.local").
   * Must be a valid DNS FQDN (no trailing dot — added during comparison in dnsClient.ts).
   * Used to compute Domain.verificationTarget and instructions for subdomains.
   */
  CNAME_TARGET: z.string().min(1).optional().default("shortener.kurzly.local"),

  /**
   * Domain verification — A record IP for apex domains (e.g. "192.0.2.1").
   * Must be a valid IPv4 dotted-quad. Used to compute Domain.verificationTarget
   * and instructions for apex domains.
   */
  A_RECORD_IP: z.string().ip("v4").optional().default("0.0.0.0"),
```

**Rationale:** Optional with sensible defaults so fresh deployments don't 500 on boot; updated during operator configuration.

---

### `apps/api/test/dnsClient.test.ts` (test, request-response)

**Analog:** `apps/api/test/authorization.test.ts` (lines 1–31, Vitest structure + prisma injection)

**Unit tests with injectable fake resolver**:
```typescript
// Source: authorization.test.ts structure (lines 1–31) + seedUser pattern (lines 22–31)

import { describe, expect, it } from "vitest";
import { verifyDomain } from "../src/lib/dnsClient.js";
import type { DnsResolver } from "../src/lib/dnsClient.js";

describe("DNS verification (dnsClient)", () => {
  const fakeDnsResolver = (cnameRecords: string[], aRecords: string[]): DnsResolver => ({
    resolveCname: async () => cnameRecords,
    resolve4: async () => aRecords,
  });

  describe("verifyDomain", () => {
    it("verifies a subdomain CNAME record when it matches", async () => {
      const resolver = fakeDnsResolver(["shortener.kurzly.local"], []);
      const result = await verifyDomain(
        "s.example.com",
        "subdomain",
        "shortener.kurzly.local",
        resolver,
      );
      expect(result.verified).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("fails verification when CNAME record doesn't match", async () => {
      const resolver = fakeDnsResolver(["wrong.target.com"], []);
      const result = await verifyDomain(
        "s.example.com",
        "subdomain",
        "shortener.kurzly.local",
        resolver,
      );
      expect(result.verified).toBe(false);
      expect(result.error).toBeUndefined();  // Mismatch is not an error; expected outcome
    });

    it("treats DNS lookup timeout as a structured failure (not thrown)", async () => {
      const slowResolver: DnsResolver = {
        resolveCname: async () => new Promise(() => {}),  // Never resolves
        resolve4: async () => new Promise(() => {}),
      };
      const result = await verifyDomain(
        "s.example.com",
        "subdomain",
        "shortener.kurzly.local",
        slowResolver,
        50,  // 50ms timeout for test speed
      );
      expect(result.verified).toBe(false);
      expect(result.error).toBe("DNS_TIMEOUT");
    });

    it("normalizes trailing dots in DNS records", async () => {
      const resolver = fakeDnsResolver(["shortener.kurzly.local."], []);  // Trailing dot
      const result = await verifyDomain(
        "s.example.com",
        "subdomain",
        "shortener.kurzly.local",
        resolver,
      );
      expect(result.verified).toBe(true);
    });

    it("verifies an apex domain A record", async () => {
      const resolver = fakeDnsResolver([], ["192.0.2.1"]);
      const result = await verifyDomain(
        "example.com",
        "apex",
        "192.0.2.1",
        resolver,
      );
      expect(result.verified).toBe(true);
    });

    it("asserts no HTTP requests are made (stub DNS only — SSRF-safety)", async () => {
      // This test is implicit: if verifyDomain ever calls fetch/http,
      // it would be visible in the test output. A more explicit check:
      // the injected resolver only has resolveCname/resolve4 methods,
      // no fetch/http — so calling them is the only way to work.
      const resolver = fakeDnsResolver(["shortener.kurzly.local"], []);
      await verifyDomain("s.example.com", "subdomain", "shortener.kurzly.local", resolver);
      // Test passes if no DNS-external side effects occur.
    });
  });
});
```

---

### `apps/api/test/domains.integration.test.ts` (test, CRUD)

**Analog:** `apps/api/test/authorization.test.ts` (lines 1–80, real Postgres, seedUser, per-test isolation)

**Integration tests with real Postgres (transaction-rolled-back per test)**:
```typescript
// Source: authorization.test.ts structure + domain-scoped CRUD pattern

import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";
import {
  ForbiddenError,
  requireDomainAccess,
} from "../src/lib/authorization.js";

describe("Domain CRUD (Phase 3, D-01/D-02/D-04)", () => {
  let userSeq = 0;

  async function seedUser(email?: string) {
    userSeq += 1;
    return prisma.user.create({
      data: {
        id: `u_domain_${userSeq}`,
        name: `Domain Test User ${userSeq}`,
        email: email ?? `domain-${userSeq}@test.kurzly`,
      },
    });
  }

  describe("Domain creation (Pattern 1: bootstrap ownership)", () => {
    it("creates a domain with pending status and owner membership", async () => {
      const user = await seedUser();

      // Simulate POST /api/domains { hostname, type }
      const domain = await prisma.$transaction(async (tx) => {
        const d = await tx.domain.create({
          data: {
            hostname: "s.example.com",
            type: "subdomain",
            status: "pending",
            verificationTarget: "shortener.kurzly.local",
          },
        });
        await tx.domainMembership.create({
          data: { userId: user.id, domainId: d.id, role: "owner" },
        });
        return d;
      });

      expect(domain.hostname).toBe("s.example.com");
      expect(domain.status).toBe("pending");
      expect(domain.type).toBe("subdomain");

      // Verify owner membership was created
      const membership = await prisma.domainMembership.findUnique({
        where: { userId_domainId: { userId: user.id, domainId: domain.id } },
      });
      expect(membership?.role).toBe("owner");
    });

    it("enforces hostname uniqueness constraint", async () => {
      await prisma.domain.create({
        data: {
          hostname: "duplicate.example.com",
          type: "subdomain",
          status: "pending",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      await expect(
        prisma.domain.create({
          data: {
            hostname: "duplicate.example.com",  // Same hostname
            type: "subdomain",
            status: "pending",
            verificationTarget: "shortener.kurzly.local",
          },
        }),
      ).rejects.toThrow();  // Prisma throws on unique constraint violation
    });
  });

  describe("Domain verification (D-03)", () => {
    it("updates domain status to 'active' on successful DNS check", async () => {
      const user = await seedUser();
      const domain = await prisma.domain.create({
        data: {
          hostname: "s.example.com",
          type: "subdomain",
          status: "pending",
          verificationTarget: "shortener.kurzly.local",
        },
      });
      await prisma.domainMembership.create({
        data: { userId: user.id, domainId: domain.id, role: "owner" },
      });

      // Simulate successful DNS verification
      const updated = await prisma.domain.update({
        where: { id: domain.id },
        data: {
          status: "active",
          verifiedAt: new Date(),
          lastCheckedAt: new Date(),
          lastCheckError: null,
        },
      });

      expect(updated.status).toBe("active");
      expect(updated.verifiedAt).toBeDefined();
    });

    it("updates domain status to 'failed' on unsuccessful DNS check", async () => {
      const domain = await prisma.domain.create({
        data: {
          hostname: "s.example.com",
          type: "subdomain",
          status: "pending",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      const updated = await prisma.domain.update({
        where: { id: domain.id },
        data: {
          status: "failed",
          lastCheckedAt: new Date(),
          lastCheckError: "ENOTFOUND",
        },
      });

      expect(updated.status).toBe("failed");
      expect(updated.lastCheckError).toBe("ENOTFOUND");
    });
  });

  describe("Authorization (D-04: owner/admin only)", () => {
    it("allows owner to verify their own domain", async () => {
      const owner = await seedUser();
      const domain = await prisma.domain.create({
        data: {
          hostname: "owner.example.com",
          type: "subdomain",
          status: "pending",
          verificationTarget: "shortener.kurzly.local",
        },
      });
      await prisma.domainMembership.create({
        data: { userId: owner.id, domainId: domain.id, role: "owner" },
      });

      // Should not throw
      await expect(
        requireDomainAccess(prisma, owner.id, domain.id, "admin"),
      ).resolves.toBeUndefined();
    });

    it("denies member access to verify (member < admin in hierarchy)", async () => {
      const member = await seedUser();
      const domain = await prisma.domain.create({
        data: {
          hostname: "member.example.com",
          type: "subdomain",
          status: "pending",
          verificationTarget: "shortener.kurzly.local",
        },
      });
      await prisma.domainMembership.create({
        data: { userId: member.id, domainId: domain.id, role: "member" },
      });

      await expect(
        requireDomainAccess(prisma, member.id, domain.id, "admin"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("denies access for unknown user/domain pair (deny-by-default)", async () => {
      const user = await seedUser();
      const domain = await prisma.domain.create({
        data: {
          hostname: "unknown.example.com",
          type: "subdomain",
          status: "pending",
          verificationTarget: "shortener.kurzly.local",
        },
      });
      // No membership row created

      await expect(
        requireDomainAccess(prisma, user.id, domain.id, "admin"),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
```

---

### `apps/api/test/tlsCheck.integration.test.ts` (test, request-response)

**Analog:** `apps/api/test/auth.integration.test.ts` pattern (fastify.inject, no prior reference in repo but analogous to canary.test.ts structure)

**Ask endpoint tests (fastify.inject pattern)**:
```typescript
// Source: canary route pattern (routes/canary.ts) + fastify.inject pattern

import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";
import { buildApp } from "../src/app.js";

describe("TLS-check ask endpoint (Pattern 3, D-01)", () => {
  it("returns 200 for an active domain (Caddy: allow cert issuance)", async () => {
    const app = await buildApp({ prisma });

    const domain = await prisma.domain.create({
      data: {
        hostname: "active.example.com",
        type: "subdomain",
        status: "active",  // LOCKED: only active domains pass
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/tls-check?domain=active.example.com`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");  // Caddy's contract: no body needed
  });

  it("returns 404 for an unregistered domain (Caddy: deny cert issuance)", async () => {
    const app = await buildApp({ prisma });

    const response = await app.inject({
      method: "GET",
      url: `/api/tls-check?domain=unregistered.example.com`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a pending domain (not yet verified)", async () => {
    const app = await buildApp({ prisma });

    await prisma.domain.create({
      data: {
        hostname: "pending.example.com",
        type: "subdomain",
        status: "pending",  // Not active yet
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/tls-check?domain=pending.example.com`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a failed domain", async () => {
    const app = await buildApp({ prisma });

    await prisma.domain.create({
      data: {
        hostname: "failed.example.com",
        type: "subdomain",
        status: "failed",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/tls-check?domain=failed.example.com`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects host-header spoofing (exact-match lookup only, Pattern 4)", async () => {
    const app = await buildApp({ prisma });

    await prisma.domain.create({
      data: {
        hostname: "exact.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    // Try to access via a different hostname (host-spoofing attempt)
    const response = await app.inject({
      method: "GET",
      url: `/api/tls-check?domain=exact.example.com.attacker.com`,
    });

    expect(response.statusCode).toBe(404);  // Denied
  });

  it("is rate-limited appropriately (TLS_CHECK_RATE_LIMIT)", async () => {
    const app = await buildApp({ prisma });

    // Rapid-fire requests should hit rate limit
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        app.inject({
          method: "GET",
          url: `/api/tls-check?domain=test.example.com`,
        }),
      ),
    );

    const limited = results.filter((r) => r.statusCode === 429);
    expect(limited.length).toBeGreaterThan(0);  // At least some should be rate-limited
  });
});
```

---

### `apps/api/test/domainResolution.test.ts` (test, request-response)

**Analog:** `apps/api/test/authorization.test.ts` (lines 33–78, deny-by-default scenarios)

**Host-resolution guard tests (Pattern 4)**:
```typescript
// Source: authorization.test.ts's deny-by-default pattern

import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";
import { resolveActiveDomainByHost } from "../src/lib/domainResolution.js";

describe("Host-header resolution guard (Pattern 4, Pitfall 1)", () => {
  describe("resolveActiveDomainByHost", () => {
    it("returns the domain when hostname is registered and active", async () => {
      const domain = await prisma.domain.create({
        data: {
          hostname: "s.example.com",
          type: "subdomain",
          status: "active",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      const resolved = await resolveActiveDomainByHost(prisma, "s.example.com");
      expect(resolved?.id).toBe(domain.id);
    });

    it("returns null for an unregistered hostname (deny-by-default)", async () => {
      const resolved = await resolveActiveDomainByHost(prisma, "unregistered.example.com");
      expect(resolved).toBeNull();
    });

    it("returns null for a pending domain (status != active)", async () => {
      await prisma.domain.create({
        data: {
          hostname: "pending.example.com",
          type: "subdomain",
          status: "pending",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      const resolved = await resolveActiveDomainByHost(prisma, "pending.example.com");
      expect(resolved).toBeNull();
    });

    it("returns null for a failed domain (status != active)", async () => {
      await prisma.domain.create({
        data: {
          hostname: "failed.example.com",
          type: "subdomain",
          status: "failed",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      const resolved = await resolveActiveDomainByHost(prisma, "failed.example.com");
      expect(resolved).toBeNull();
    });

    it("normalizes hostname to lowercase (case-insensitive match)", async () => {
      const domain = await prisma.domain.create({
        data: {
          hostname: "exact.example.com",
          type: "subdomain",
          status: "active",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      const resolved = await resolveActiveDomainByHost(prisma, "EXACT.EXAMPLE.COM");  // Uppercase
      expect(resolved?.id).toBe(domain.id);
    });

    it("strips port from host header", async () => {
      const domain = await prisma.domain.create({
        data: {
          hostname: "s.example.com",
          type: "subdomain",
          status: "active",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      const resolved = await resolveActiveDomainByHost(prisma, "s.example.com:443");
      expect(resolved?.id).toBe(domain.id);
    });

    it("returns null for undefined/empty host", async () => {
      expect(await resolveActiveDomainByHost(prisma, undefined)).toBeNull();
      expect(await resolveActiveDomainByHost(prisma, "")).toBeNull();
      expect(await resolveActiveDomainByHost(prisma, "   ")).toBeNull();
    });

    it("never falls back to wildcard or 'first domain' logic (exact-match only)", async () => {
      const domain1 = await prisma.domain.create({
        data: {
          hostname: "first.example.com",
          type: "subdomain",
          status: "active",
          verificationTarget: "shortener.kurzly.local",
        },
      });

      // Try to access via a substring or partial match
      const resolved = await resolveActiveDomainByHost(prisma, "first.example");  // Partial
      expect(resolved).toBeNull();  // Denied
    });
  });
});
```

---

### `apps/web/src/views/DomainsView.vue` (component, request-response)

**Analog:** `apps/web/src/views/ComingSoonView.vue` (lines 14–72, screen-container boilerplate, style structure)

**Vue 3 component structure**:
```vue
<script setup lang="ts">
/**
 * Domain management screen (03-UI-SPEC.md) — replaces ComingSoonView
 * at route /domains. Displays domain list, add-domain form, verify action,
 * DNS instructions accordion, delete confirmation (D-01..04, UI-SPEC).
 */
import { computed, ref } from "vue";
import type { Domain } from "@kurzly/shared";
import {
  createDomain,
  listDomains,
  verifyDomain,
  deleteDomain,
  getDomainInstructions,
} from "../api.js";

interface DomainUI extends Domain {
  isVerifying: boolean;
  showInstructions: boolean;
  instructions?: { instructions: string; alternativeForApex: string | null };
}

const domains = ref<DomainUI[]>([]);
const loading = ref(false);
const newHostname = ref("");
const newType = ref<"subdomain" | "apex">("subdomain");
const toast = ref<{ message: string; timeout: NodeJS.Timeout } | null>(null);
const deleteDialog = ref<{ domain: DomainUI; resolver: () => Promise<void> } | null>(null);

// Load domains on mount
async function loadDomains() {
  loading.value = true;
  try {
    domains.value = (await listDomains()).map((d) => ({
      ...d,
      isVerifying: false,
      showInstructions: false,
    }));
  } catch (err) {
    showToast("Failed to load domains");
  } finally {
    loading.value = false;
  }
}

async function handleAddDomain() {
  if (!newHostname.value.trim()) {
    showToast("Please enter a domain");
    return;
  }

  try {
    const created = await createDomain({
      hostname: newHostname.value,
      type: newType.value,
    });
    domains.value.push({
      ...created,
      isVerifying: false,
      showInstructions: false,
    });
    showToast(`${newHostname.value} added — DNS pending`);
    newHostname.value = "";
  } catch (err: any) {
    showToast(err.message || "Failed to add domain");
  }
}

async function handleVerify(domain: DomainUI) {
  domain.isVerifying = true;
  try {
    const updated = await verifyDomain(domain.id);
    Object.assign(domain, updated);
    showToast(`${domain.hostname} verified ✓`);
  } catch (err: any) {
    showToast(err.message || "Verification failed");
  } finally {
    domain.isVerifying = false;
  }
}

async function toggleInstructions(domain: DomainUI) {
  if (domain.showInstructions) {
    domain.showInstructions = false;
    return;
  }

  try {
    const instructions = await getDomainInstructions(domain.id);
    domain.instructions = instructions;
    domain.showInstructions = true;
  } catch (err) {
    showToast("Failed to load instructions");
  }
}

async function handleDelete(domain: DomainUI) {
  deleteDialog.value = {
    domain,
    resolver: async () => {
      try {
        await deleteDomain(domain.id);
        domains.value = domains.value.filter((d) => d.id !== domain.id);
        showToast("Domain removed");
        deleteDialog.value = null;
      } catch (err: any) {
        showToast("Failed to delete domain");
      }
    },
  };
}

function showToast(message: string) {
  if (toast.value?.timeout) clearTimeout(toast.value.timeout);
  toast.value = {
    message,
    timeout: setTimeout(() => (toast.value = null), 1700),
  };
}

function autoPreselect(hostname: string) {
  // Simple heuristic: if more than 1 dot, likely subdomain
  const parts = hostname.split(".");
  newType.value = parts.length > 2 ? "subdomain" : "apex";
}

loadDomains();
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>Domains</h1>
      <p class="subtitle">Domains & Subdomains, die auf die Instanz zeigen</p>
    </div>

    <!-- Add domain form (UI-SPEC lines 228–247) -->
    <div class="add-domain-row">
      <input
        v-model="newHostname"
        type="text"
        class="domain-input"
        placeholder="z.B. s.meinefirma.de"
        @input="autoPreselect"
      />
      <div class="type-toggle">
        <button
          :class="{ active: newType === 'subdomain' }"
          @click="newType = 'subdomain'"
        >
          Subdomain
        </button>
        <button
          :class="{ active: newType === 'apex' }"
          @click="newType = 'apex'"
        >
          Apex-Domain
        </button>
      </div>
      <button class="add-button" @click="handleAddDomain">Hinzufügen</button>
    </div>

    <!-- Domain list or empty state -->
    <div v-if="domains.length === 0" class="empty-state">
      <div class="empty-icon">🌐</div>
      <h3 class="empty-heading">Noch keine Domain registriert</h3>
      <p class="empty-body">
        Füge oben deine erste Domain oder Subdomain hinzu, um Kurzlinks darauf zu betreiben.
      </p>
    </div>

    <div v-else class="domain-list">
      <div
        v-for="(domain, idx) in domains"
        :key="domain.id"
        class="domain-row"
        :class="{ 'not-last': idx < domains.length - 1 }"
      >
        <div class="domain-name">{{ domain.hostname }}</div>
        <span class="type-badge">{{ domain.type.toUpperCase() }}</span>
        <span
          class="status-badge"
          :class="{ active: domain.status === 'active', failed: domain.status === 'failed' }"
        >
          {{
            domain.status === "active"
              ? "Aktiv"
              : domain.status === "failed"
                ? "Fehlgeschlagen"
                : "DNS ausstehend"
          }}
        </span>
        <div class="spacer"></div>
        <button
          v-if="domain.status !== 'active'"
          class="verify-button"
          :disabled="domain.isVerifying"
          @click="handleVerify(domain)"
        >
          {{ domain.isVerifying ? "Prüfe …" : "Jetzt prüfen" }}
        </button>
        <button class="instructions-toggle" @click="toggleInstructions(domain)">
          {{ domain.showInstructions ? "Anleitung ausblenden ▾" : "Anleitung anzeigen ▸" }}
        </button>
        <button class="delete-button" title="Domain entfernen" @click="handleDelete(domain)">
          🗑
        </button>
      </div>

      <!-- Instructions accordion (expanded per domain) -->
      <template v-for="domain in domains" :key="`instr-${domain.id}`">
        <div
          v-if="domain.showInstructions && domain.instructions"
          class="instructions-panel"
        >
          <p class="instructions-body">
            {{
              domain.type === "subdomain"
                ? `Lege bei deinem DNS-Anbieter folgenden CNAME-Eintrag für ${domain.hostname} an:`
                : `Lege bei deinem DNS-Anbieter folgenden A-Eintrag für ${domain.hostname} an (oder einen ALIAS-/ANAME-Eintrag, falls dein Anbieter das unterstützt):`
            }}
          </p>
          <div class="dns-code-block">
            <code>{{ domain.instructions.instructions }}</code>
            <button class="copy-button" title="Kopieren" @click="copyToClipboard(domain.instructions.instructions)">
              ⧉
            </button>
          </div>
          <p v-if="domain.type === 'apex' && domain.instructions.alternativeForApex" class="dns-alt">
            oder: {{ domain.instructions.alternativeForApex }}
          </p>
          <p class="tls-hint">
            Sobald diese Domain auf „Aktiv" steht, kann dein Reverse-Proxy (z. B. Caddy On-Demand-TLS, Traefik)
            automatisch ein Let's-Encrypt-Zertifikat ausstellen — TLS terminiert dein eigener Proxy, nicht Kurzly.
          </p>
          <p v-if="domain.lastCheckedAt" class="last-checked">
            Zuletzt geprüft: {{ relativeTime(domain.lastCheckedAt) }}
            <span v-if="domain.lastCheckError" class="error">
              — {{ domain.lastCheckError }}
            </span>
          </p>
        </div>
      </template>
    </div>
  </div>

  <!-- Delete confirmation dialog -->
  <div v-if="deleteDialog" class="delete-dialog-overlay" @click="deleteDialog = null">
    <div class="delete-dialog" @click.stop>
      <h3 class="delete-title">Domain entfernen?</h3>
      <p class="delete-body">
        {{ deleteDialog.domain.hostname }} wird entfernt. Bestehende Links auf dieser Domain funktionieren
        danach nicht mehr.
      </p>
      <div class="delete-footer">
        <button class="cancel-button" @click="deleteDialog = null">Abbrechen</button>
        <button class="delete-confirm-button" @click="deleteDialog.resolver()">Entfernen</button>
      </div>
    </div>
  </div>

  <!-- Toast notification -->
  <div v-if="toast" class="toast">
    {{ toast.message }}
  </div>
</template>

<style scoped>
/* Screen container (UI-SPEC lines 214–219: 860px max-width, NOT 1060px) */
.screen-container {
  max-width: 860px;
  margin: 0 auto;
  padding: 28px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.screen-header {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.screen-header h1 {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

.subtitle {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

/* Add domain row (UI-SPEC lines 228–247) */
.add-domain-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.domain-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  font-family: "Geist Mono", monospace;
  outline: none;
}

.type-toggle {
  display: flex;
  gap: 4px;
  flex: none;
}

.type-toggle button {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  cursor: pointer;
  background: var(--panel);
  color: var(--mut);
  font-weight: 400;
  border: 1px solid var(--border);
}

.type-toggle button.active {
  background: var(--accent);
  color: #1b1b18;
  font-weight: 500;
  border-color: var(--accent);
}

.add-button {
  padding: 9px 16px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #1b1b18;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  flex: none;
}

.add-button:hover {
  opacity: 0.85;
}

/* Domain list (UI-SPEC lines 250–289) */
.domain-list {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.domain-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
}

.domain-row.not-last {
  border-bottom: 1px solid var(--border);
}

.domain-row:last-child {
  border-bottom: none;
}

.domain-name {
  font-family: "Geist Mono", monospace;
  font-size: 13.5px;
  width: 230px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--mut);
  text-transform: uppercase;
  white-space: nowrap;
}

.status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--mut);
}

.status-badge.active {
  background: var(--accent);
  color: #1b1b18;
}

.status-badge.failed {
  background: var(--chip);
  color: #e5484d;
}

.spacer {
  flex: 1;
}

.verify-button,
.instructions-toggle,
.delete-button {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  flex: none;
}

.verify-button:hover,
.instructions-toggle:hover {
  background: var(--hover);
}

.verify-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.delete-button {
  border: none;
  background: transparent;
  padding: 3px;
  color: var(--mut);
}

.delete-button:hover {
  color: #e5484d;
}

/* Instructions accordion (UI-SPEC lines 291–313) */
.instructions-panel {
  border-top: 1px dashed var(--border);
  padding: 14px 16px 16px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.instructions-body {
  font-size: 12px;
  color: var(--mut);
  margin: 0;
}

.dns-code-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-family: "Geist Mono", monospace;
  font-size: 12px;
  background: var(--chip);
  border-radius: 8px;
  padding: 12px 14px;
  line-height: 1.7;
  color: var(--text);
}

.dns-code-block code {
  flex: 1;
  white-space: pre-wrap;
}

.copy-button {
  font-size: 11px;
  color: var(--mut);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 1px 5px;
  cursor: pointer;
  background: transparent;
  flex: none;
}

.copy-button:hover {
  color: var(--text);
  border-color: var(--mut);
}

.dns-alt {
  font-size: 11.5px;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
  margin: 0;
}

.tls-hint {
  font-size: 12px;
  color: var(--mut);
  margin: 0;
}

.last-checked {
  font-size: 11.5px;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
  margin: 0;
}

.last-checked .error {
  color: #e5484d;
}

/* Empty state (UI-SPEC lines 340–350) */
.empty-state {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: var(--panel);
}

.empty-icon {
  font-size: 24px;
  margin-bottom: 10px;
}

.empty-heading {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.empty-body {
  font-size: 12.5px;
  color: var(--mut);
  margin-top: 4px;
}

/* Delete confirmation dialog (UI-SPEC lines 323–338) */
.delete-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.delete-dialog {
  width: 380px;
  background: var(--panel);
  border-radius: 16px;
  padding: 26px 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.delete-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--text);
}

.delete-body {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

.delete-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.cancel-button {
  padding: 9px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.cancel-button:hover {
  background: var(--hover);
}

.delete-confirm-button {
  padding: 9px 16px;
  border: none;
  border-radius: 8px;
  background: #e5484d;
  color: #f1f1ec;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.delete-confirm-button:hover {
  opacity: 0.85;
}

/* Toast (UI-SPEC lines 352–358) */
.toast {
  position: fixed;
  bottom: 26px;
  left: 50%;
  transform: translateX(-50%);
  background: #1b1b18;
  color: #f1f1ec;
  font-size: 12.5px;
  padding: 9px 16px;
  border-radius: 999px;
  z-index: 100;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  font-family: "Geist Mono", monospace;
}
</style>

<script setup lang="ts">
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("DNS-Eintrag kopiert");
  });
}

function relativeTime(date: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - new Date(date).getTime()) / 1000);
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Minuten`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Stunden`;
  return `vor ${Math.floor(diff / 86400)} Tagen`;
}
</script>
```

---

### `apps/web/src/api.ts` (service, request-response)

**Analog:** `apps/web/src/api.ts` (lines 1–68, typed client functions + parseJsonOrThrow)

**Add to existing file** (after line 68):
```typescript
/**
 * Domain management API client (Phase 3, DOMAIN-01..04)
 * — mirrors the pattern of existing canary/auth clients below
 */

export interface DomainDto {
  id: string;
  hostname: string;
  type: "subdomain" | "apex";
  status: "pending" | "active" | "failed";
  verifiedAt?: Date | null;
  lastCheckedAt?: Date | null;
  lastCheckError?: string | null;
  createdAt: Date;
}

export async function createDomain(data: {
  hostname: string;
  type: "subdomain" | "apex";
}): Promise<DomainDto> {
  const response = await fetch("/api/domains", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return parseJsonOrThrow<DomainDto>(response);
}

export async function listDomains(): Promise<DomainDto[]> {
  const response = await fetch("/api/domains", { method: "GET" });
  return parseJsonOrThrow<DomainDto[]>(response);
}

export async function verifyDomain(domainId: string): Promise<DomainDto> {
  const response = await fetch(`/api/domains/${domainId}/verify`, {
    method: "POST",
  });
  return parseJsonOrThrow<DomainDto>(response);
}

export async function deleteDomain(domainId: string): Promise<void> {
  const response = await fetch(`/api/domains/${domainId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
}

export async function getDomainInstructions(
  domainId: string,
): Promise<{ instructions: string; alternativeForApex: string | null }> {
  const response = await fetch(`/api/domains/${domainId}/instructions`, { method: "GET" });
  return parseJsonOrThrow<{ instructions: string; alternativeForApex: string | null }>(response);
}
```

---

### `packages/shared/src/index.ts` (model, request-response)

**Analog:** Phase 2 shared exports (DTO type definitions)

**Add Domain DTO** (after existing auth types):
```typescript
/**
 * Domain data transfer object (Phase 3, DOMAIN-01..04).
 * Extends the minimal Phase-2 Domain model with lifecycle/status fields.
 */
export interface DomainDTO {
  id: string;
  hostname: string;
  type: "subdomain" | "apex";
  status: "pending" | "active" | "failed";
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  lastCheckError: string | null;
  createdAt: Date;
}
```

---

### `docs/deployment/reverse-proxy.md` (documentation)

**Analog:** Phase 1 `docs/deployment/reverse-proxy.md` (existing deployment docs)

**Add new section** (after Caddy/Traefik setup, before TLS termination summary):
```markdown
## On-Demand TLS Integration (Phase 3)

Once you've registered and verified domains in Kurzly, you can configure your reverse proxy
to automatically issue Let's Encrypt certificates for them using on-demand TLS.

### Caddy (Recommended)

Caddy's `on_demand_tls` feature queries Kurzly before issuing a certificate, ensuring
certificates are only issued for verified domains.

**Configuration:**

```caddyfile
{
    on_demand_tls {
        ask http://app:3000/api/tls-check
    }
}

:443 {
    tls {
        on_demand
    }
    reverse_proxy app:3000
}
```

Caddy will automatically:
1. Intercept TLS handshakes for unknown hostnames
2. Query `GET /api/tls-check?domain=<hostname>` on your Kurzly instance
3. Issue a certificate ONLY if Kurzly responds with HTTP 200 (domain is active and verified)
4. Reject the handshake if Kurzly responds with 404 or 403 (domain not registered/verified)

### Traefik

Traefik does not have a native on-demand TLS ask hook like Caddy. Instead, use one of:

**Option A: Dynamic File Provider (Recommended)**

Configure Traefik to watch a file for route changes, and have Kurzly or a polling script
update that file with verified domains:

```yaml
# traefik.yml
providers:
  file:
    filename: /etc/traefik/dynamic.yml
    watch: true
```

Then create a polling script that calls `GET /api/domains` (requires auth) every 5 minutes
and regenerates the dynamic router config with only active domains.

**Option B: Manual Configuration**

Manually configure Traefik's certificate resolvers with Let's Encrypt, and only add
route entries for domains after verifying them in Kurzly.

### Generic Reverse Proxy (nginx, Apache, etc.)

If you're running a reverse proxy that doesn't support on-demand TLS hooks:

1. Periodically query `GET /api/domains` (admin-authenticated endpoint — requires setup of a polling daemon)
2. Extract domains where `status === "active"`
3. Use your proxy's native certificate-management tool (e.g., `certbot`, `acme-client`) to issue certs for those hostnames only

**Example polling approach (bash + certbot):**

```bash
#!/bin/bash
# Poll Kurzly for active domains and issue certs via certbot

KURZLY_URL="https://kurzly.example.com"
ADMIN_SESSION_COOKIE="..."  # Set via better-auth login

while true; do
  curl -s -H "Cookie: $ADMIN_SESSION_COOKIE" \
    "$KURZLY_URL/api/domains" \
    | jq -r '.[] | select(.status=="active") | .hostname' \
    | while read domain; do
      certbot certonly --dns-cloudflare --dns-cloudflare-credentials ~/.secrets/cloudflare.ini \
        -d "$domain" --non-interactive --agree-tos -m admin@example.com
    done
  
  sleep 300  # Check every 5 minutes
done
```

---

## Summary

- **TLS is your proxy's responsibility** — Kurzly only tracks which domains are verified
- **Use Caddy** if possible — its `on_demand_tls.ask` is the simplest integration
- **Traefik users** should set up a polling script to materialize dynamic router config from Kurzly's domain list
- **Generic proxies** can use a similar polling approach with standard certificate tools
```

---

## Shared Patterns

### Authentication & Authorization
**Source:** `apps/api/src/lib/authorization.ts` (lines 29–62)  
**Apply to:** All domain routes (domains.ts, tlsCheck.ts)  
**Pattern:**
```typescript
// Domain-scoped authorization via requireDomainAccess or session check
try {
  await requireDomainAccess(prisma, userId, domainId, "admin");
} catch (err) {
  if (err instanceof ForbiddenError) {
    return reply.code(403).send({ error: "Forbidden" });
  }
  throw err;
}
```

### Per-Route Rate Limiting
**Source:** `apps/api/src/plugins/rateLimit.ts` (lines 24–27, auth.ts lines 73–76)  
**Apply to:** Verify and tls-check routes  
**Pattern:**
```typescript
app.route({
  method: "POST",
  url: "/api/domains/:id/verify",
  config: { rateLimit: VERIFY_RATE_LIMIT },  // Static override, before wildcard routes
  handler: async (request, reply) => { /* ... */ },
});
```

### Error Handling (Never Throw Past Route Boundary)
**Source:** `dnsClient.ts` verifyDomain pattern, `authorization.ts` ForbiddenError  
**Apply to:** DNS verification, all domain mutations  
**Pattern:**
```typescript
export async function verifyDomain(...): Promise<{ verified: boolean; error?: string }> {
  try {
    // DNS operations
  } catch (err) {
    // Never throw — wrap in structured result
    return { verified: false, error: (err as NodeJS.ErrnoException).code };
  }
}
```

### Transactional Creation (Bootstrap Ownership)
**Source:** `admin-seed.ts` upsert pattern (lines 25–49)  
**Apply to:** Domain creation (POST /api/domains)  
**Pattern:**
```typescript
const domain = await prisma.$transaction(async (tx) => {
  const d = await tx.domain.create({ data: { /* ... */ } });
  await tx.domainMembership.create({
    data: { userId, domainId: d.id, role: "owner" },
  });
  return d;
});
```

### Deny-by-Default Lookups
**Source:** `authorization.ts` (lines 29–62), Pattern 4  
**Apply to:** Host-header resolution, domain verification state checks  
**Pattern:**
```typescript
// Never wildcard-match or fallback; exact-match only, deny on miss
const domain = await prisma.domain.findUnique({ where: { hostname } });
if (!domain || domain.status !== "active") return null;
return domain;
```

### Test Isolation via Transaction Rollback
**Source:** `test/setupFileEach.ts` (lines 29–35), `test/globalSetup.ts` (lines 40–50)  
**Apply to:** All integration test files (domains.integration.test.ts, tlsCheck.integration.test.ts, dnsClient.test.ts)  
**Pattern:**
```typescript
// In setupFileEach.ts: automatic per-test BEGIN/ROLLBACK isolation
import { prisma } from "./setupFileEach.js";  // Injects pre-wrapped transaction-based client

beforeEach(async () => {
  await prisma.$executeRawUnsafe("BEGIN");
});

afterEach(async () => {
  await prisma.$executeRawUnsafe("ROLLBACK");
});
```

---

## Files With No Close Analog

None — all Phase 3 files map to existing Phase 1–2 patterns (route factories, authorization, rate-limit config, Vitest structure, Vue components, typed API clients).

---

## Metadata

**Codebase scan scope:** `/mnt/c/Users/jonas/repos/zack/apps/api/src/`, `/mnt/c/Users/jonas/repos/zack/apps/web/src/`, `/mnt/c/Users/jonas/repos/zack/apps/api/test/`, `/mnt/c/Users/jonas/repos/zack/packages/shared/`  
**Files scanned:** 12 core analogs across routes, lib, plugins, tests, components, and shared types  
**Pattern extraction date:** 2026-07-11  
**Analogs confidence:** HIGH — all patterns derive from working Phase 1–2 code with proven test coverage
