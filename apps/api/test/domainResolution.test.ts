/**
 * Host-header resolution guard unit suite (Pattern 4, Pitfall 1, T-03-02) —
 * proves `resolveActiveDomainByHost` is a strict, exact-match,
 * deny-by-default lookup: an active-status match resolves, everything else
 * (unregistered/pending/failed/malformed/partial/substring host) returns
 * null. This is the shared host guard the `GET /api/tls-check` ask endpoint
 * (03-03 Task 2) and the Phase 5 redirect engine both depend on — see
 * apps/api/src/lib/authorization.ts's own deny-by-default contract for the
 * precedent this mirrors.
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test, D-09).
 */
import { describe, expect, it } from "vitest";
import { resolveActiveDomainByHost } from "../src/lib/domainResolution.js";
import { prisma } from "./setupFileEach.js";

describe("resolveActiveDomainByHost (Pattern 4, deny-by-default)", () => {
  it("returns the Domain row for a registered, active hostname (exact match)", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "active.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const resolved = await resolveActiveDomainByHost(prisma, "active.example.com");
    expect(resolved?.id).toBe(domain.id);
  });

  it("returns null for an unregistered hostname", async () => {
    const resolved = await resolveActiveDomainByHost(prisma, "unregistered.example.com");
    expect(resolved).toBeNull();
  });

  it("returns null for a pending domain (status must equal 'active')", async () => {
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

  it("returns null for a failed domain (status must equal 'active')", async () => {
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

  it("matches case-insensitively against the lowercased stored hostname", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "mixedcase.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const resolved = await resolveActiveDomainByHost(prisma, "MixedCase.Example.COM");
    expect(resolved?.id).toBe(domain.id);
  });

  it("strips a trailing dot from the queried host before matching (CR-01, shared normalizeHostname)", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "trailingdot.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const resolved = await resolveActiveDomainByHost(prisma, "trailingdot.example.com.");
    expect(resolved?.id).toBe(domain.id);
  });

  it("strips a trailing :port suffix before matching", async () => {
    const domain = await prisma.domain.create({
      data: {
        hostname: "porttest.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    const resolved = await resolveActiveDomainByHost(prisma, "porttest.example.com:443");
    expect(resolved?.id).toBe(domain.id);
  });

  it("returns null for undefined, empty, and whitespace-only hosts", async () => {
    expect(await resolveActiveDomainByHost(prisma, undefined)).toBeNull();
    expect(await resolveActiveDomainByHost(prisma, "")).toBeNull();
    expect(await resolveActiveDomainByHost(prisma, "   ")).toBeNull();
  });

  it("never falls back to a wildcard/first-domain match for a partial/substring host", async () => {
    await prisma.domain.create({
      data: {
        hostname: "first.example.com",
        type: "subdomain",
        status: "active",
        verificationTarget: "shortener.kurzly.local",
      },
    });

    // "first.example" is a substring/partial of the registered hostname —
    // must NOT resolve (no wildcard, no substring, no first-domain fallback).
    const resolved = await resolveActiveDomainByHost(prisma, "first.example");
    expect(resolved).toBeNull();
  });
});
