/**
 * Team hardening suite (Phase 9 code-review fixes, 09-REVIEW WR-01/WR-02/WR-03)
 * — a NEW file, separate from the plan's existing `team.integration.test.ts`
 * (list + invite) and `team-mutations.integration.test.ts` (mutations), which
 * the plan instructed not to edit.
 *
 * Runs against `setupFileEach.ts`'s per-file real-Postgres database. The
 * WR-02 cases are pure error-translation unit tests over a mocked Prisma
 * client — they assert the P2028 (transaction-contention) mapping without
 * weakening the real `FOR UPDATE` concurrency guarantee exercised by
 * `team-mutations.integration.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../src/generated/prisma/client.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { changeMemberRole, inviteMember, removeMember } from "../src/lib/team.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

/**
 * A minimal `auth` stub — the WR-01 failure path throws inside the invite
 * transaction before `triggerMagicLinkSend` is ever reached, so
 * `signInMagicLink` is never invoked.
 */
const fakeAuth = {
  api: { signInMagicLink: vi.fn().mockResolvedValue(undefined) },
} as unknown as Parameters<typeof inviteMember>[1];

/** Seeds an active Domain and returns its id. */
async function seedDomain(hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.kurzly.local",
    },
  });
  return domain.id;
}

describe("inviteMember atomicity (WR-01)", () => {
  it("rolls back the new User row when a membership write fails mid-invite", async () => {
    const domainA = await seedDomain("wr01-atomic-a.test");
    const email = "wr01-atomic@kurzly.test";

    // A duplicated domain id passes the existence pre-check (Set-deduped, so
    // findMany still returns exactly one row) but violates DomainMembership's
    // composite primary key inside `createMany`, forcing a mid-invite failure.
    // With the invite wrapped in a single transaction, the User row must NOT
    // survive — otherwise a later re-invite would treat the orphan as a
    // resend and never assign the intended domains.
    await expect(
      inviteMember(prisma, fakeAuth, {
        email,
        accountRole: "member",
        domainIds: [domainA, domainA],
      }),
    ).rejects.toThrow();

    const rows = await prisma.user.findMany({ where: { email } });
    expect(rows).toHaveLength(0);
  });
});

describe("inviteMember resend ignores domainIds without validating them (WR-03)", () => {
  it("re-inviting an existing member resends even with an unknown domainId (no INVALID_DOMAIN)", async () => {
    const email = "wr03-resend@kurzly.test";
    await prisma.user.create({
      data: { id: randomUUID(), name: "wr03", email, emailVerified: false, accountRole: "member" },
    });

    // Per D-09-04 a re-invite is a resend only — domain assignment is the
    // dedicated PUT /:id/domains endpoint's job. So `domainIds` on a resend
    // must be ignored WITHOUT being validated: an unknown id must not surface
    // as INVALID_DOMAIN for an operation that would never apply it anyway.
    const result = await inviteMember(prisma, fakeAuth, {
      email,
      accountRole: "member",
      domainIds: ["not-a-real-domain-id"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.member.domains).toEqual([]);
  });
});

/**
 * A Prisma stub whose target lookup succeeds (an admin) but whose
 * `$transaction` rejects with P2028 — the transaction-timeout/contention
 * error the `SELECT ... FOR UPDATE` lockout guards can hit under sustained
 * concurrency. This exercises ONLY the error-translation branch; the real
 * concurrency guarantee is still covered by team-mutations.integration.test.ts.
 */
function contendingPrisma(): PrismaClient {
  const p2028 = new Prisma.PrismaClientKnownRequestError(
    "Transaction already closed: A query cannot be executed on an expired transaction.",
    { code: "P2028", clientVersion: "test" },
  );
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "admin-x", accountRole: "admin" }) },
    $transaction: vi.fn().mockRejectedValue(p2028),
  } as unknown as PrismaClient;
}

describe("lockout-guard transaction-contention mapping (WR-02)", () => {
  it("changeMemberRole demote maps a P2028 contention error to a typed CONFLICT, not a throw", async () => {
    const result = await changeMemberRole(contendingPrisma(), "admin-x", "member");
    expect(result).toEqual({ ok: false, error: "CONFLICT" });
  });

  it("removeMember maps a P2028 contention error to a typed CONFLICT, not a throw", async () => {
    const result = await removeMember(contendingPrisma(), "admin-x");
    expect(result).toEqual({ ok: false, error: "CONFLICT" });
  });
});
