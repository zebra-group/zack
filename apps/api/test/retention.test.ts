/**
 * `lib/retention.ts` unit/integration suite (Phase 6, D-12) — proves the
 * pruning FUNCTIONS directly against real Postgres (RESEARCH's Validation
 * Architecture: the pruning function is tested, not the scheduler). Seeds
 * old + recent `ClickEvent` rows and a known `Link.lifetimeClicks`, then
 * asserts `pruneClickEvents` only deletes what's older than
 * `CLICK_RETENTION_DAYS` and never touches the counter; asserts it's a
 * no-op when the env var is unset (default = never prune); and asserts
 * `pruneDailySalts` only removes salts older than the ~2-day window,
 * unconditionally of `CLICK_RETENTION_DAYS`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { pruneClickEvents, pruneDailySalts } from "../src/lib/retention.js";
import { createLink } from "../src/lib/links.js";
import { prisma } from "./setupFileEach.js";

const ORIGINAL_RETENTION_DAYS = process.env.CLICK_RETENTION_DAYS;

afterEach(() => {
  if (ORIGINAL_RETENTION_DAYS === undefined) {
    delete process.env.CLICK_RETENTION_DAYS;
  } else {
    process.env.CLICK_RETENTION_DAYS = ORIGINAL_RETENTION_DAYS;
  }
});

let userSeq = 0;

async function seedLinkWithEvents(): Promise<{ linkId: string }> {
  const userId = `retention-test-user-${userSeq++}`;
  await prisma.user.create({
    data: { id: userId, name: userId, email: `${userId}@zack.test`, emailVerified: true },
  });
  const domain = await prisma.domain.create({
    data: {
      hostname: `retention-${userSeq}.example.com`,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.kurzly.local",
    },
  });
  await prisma.domainMembership.create({ data: { userId, domainId: domain.id, role: "owner" } });
  const created = await createLink(prisma, {
    userId,
    domainId: domain.id,
    targetUrl: "https://target.example.com/",
    slug: "retention-link",
  });
  if (!created.ok) throw new Error("fixture setup failed");

  // Bump lifetimeClicks to a known non-zero value directly, mirroring what
  // recordClickHook's $transaction would have done over time — retention
  // must never touch this counter.
  await prisma.link.update({ where: { id: created.link.id }, data: { lifetimeClicks: 3 } });

  const now = Date.now();
  const oldDate = new Date(now - 40 * 24 * 60 * 60 * 1000); // 40 days ago
  const recentDate = new Date(now - 1 * 24 * 60 * 60 * 1000); // 1 day ago

  await prisma.clickEvent.create({
    data: {
      linkId: created.link.id,
      createdAt: oldDate,
      visitorHash: "old-hash",
      source: "link",
    },
  });
  await prisma.clickEvent.create({
    data: {
      linkId: created.link.id,
      createdAt: recentDate,
      visitorHash: "recent-hash",
      source: "link",
    },
  });

  return { linkId: created.link.id };
}

describe("pruneClickEvents (D-12)", () => {
  it("deletes only events older than CLICK_RETENTION_DAYS and leaves lifetimeClicks untouched", async () => {
    process.env.CLICK_RETENTION_DAYS = "30";
    const { linkId } = await seedLinkWithEvents();

    const deletedCount = await pruneClickEvents(prisma);
    expect(deletedCount).toBe(1);

    const remaining = await prisma.clickEvent.findMany({ where: { linkId } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].visitorHash).toBe("recent-hash");

    const link = await prisma.link.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.lifetimeClicks).toBe(3);
  });

  it("is a no-op returning 0 when CLICK_RETENTION_DAYS is unset", async () => {
    delete process.env.CLICK_RETENTION_DAYS;
    const { linkId } = await seedLinkWithEvents();

    const deletedCount = await pruneClickEvents(prisma);
    expect(deletedCount).toBe(0);

    const remaining = await prisma.clickEvent.findMany({ where: { linkId } });
    expect(remaining).toHaveLength(2);
  });
});

describe("pruneDailySalts (D-12, Open Question 2)", () => {
  it("removes only salt rows older than the ~2-day window, unconditionally of CLICK_RETENTION_DAYS", async () => {
    delete process.env.CLICK_RETENTION_DAYS;

    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const oldDate = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000);
    const oldKey = oldDate.toISOString().slice(0, 10);

    await prisma.dailySalt.create({ data: { date: todayKey, value: "today-salt" } });
    await prisma.dailySalt.create({ data: { date: oldKey, value: "old-salt" } });

    const deletedCount = await pruneDailySalts(prisma);
    expect(deletedCount).toBe(1);

    const remaining = await prisma.dailySalt.findMany();
    expect(remaining.map((r) => r.date)).toEqual([todayKey]);
  });
});
