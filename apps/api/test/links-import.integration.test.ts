/**
 * CSV bulk-import integration suite (LINK-08, D-01/D-05) — the D-01
 * no-bypass proof: `POST /api/links/import/commit` routes every valid CSV
 * row through the exact same `createLink()` the manual-create route uses,
 * and every skipped row (reserved slug, unauthorized domain, in-file
 * duplicate, invalid target URL) leaves ZERO trace in the database.
 *
 * Runs against `setupFileEach.ts`'s transaction-wrapped Prisma client (real
 * testcontainers Postgres, BEGIN/ROLLBACK per test) via `buildApp({ prisma
 * })`, reusing `links.integration.test.ts`'s magic-link -> verify -> cookie
 * flow to obtain a real authenticated session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { MAX_IMPORT_ROWS } from "../src/lib/links.js";
import { sendMagicLinkEmail } from "../src/lib/mailer.js";
import { prisma } from "./setupFileEach.js";

vi.mock("../src/lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

const OWNER_EMAIL = "import-owner@zack.test";

/** Joins one or more raw `Set-Cookie` headers into a single `Cookie` header value. */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/** Extracts the `token` query param from a captured magic-link verify URL. */
function extractToken(magicLinkUrl: string): string {
  const token = new URL(magicLinkUrl).searchParams.get("token");
  if (!token) {
    throw new Error(`No token found in magic-link URL: ${magicLinkUrl}`);
  }
  return token;
}

/** Requests a magic link for `email` and returns the captured verify URL. */
async function requestMagicLinkUrl(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
  });
  const call = vi.mocked(sendMagicLinkEmail).mock.calls.at(-1);
  const url = call?.[0]?.url;
  if (!url) {
    throw new Error(`sendMagicLinkEmail was not called for ${email}`);
  }
  return url;
}

/** Signs `email` in via the full magic-link round trip and returns a Cookie header. */
async function signInAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
): Promise<string> {
  const magicLinkUrl = await requestMagicLinkUrl(app, email);
  const token = extractToken(magicLinkUrl);
  const verifyRes = await app.inject({
    method: "GET",
    url: `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  });
  return toCookieHeader(verifyRes.headers["set-cookie"]);
}

/** Resolves the userId behind an already-signed-in cookie header. */
async function resolveSessionUserId(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookieHeader: string,
): Promise<string> {
  const session = await app.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie: cookieHeader },
  });
  return session.json()?.user?.id as string;
}

/**
 * Creates a Domain + owner DomainMembership for `userId` directly via
 * Prisma (test seed helper). `status: "active"` (WR-03 fix, 04-REVIEW.md):
 * `validateLinkInput` now rejects Link writes against a non-active domain
 * — every test in this suite that expects an import row to SUCCEED needs
 * an active domain fixture; `seedOwnedPendingDomain` below covers the new
 * rejection behavior explicitly.
 */
async function seedOwnedDomain(userId: string, hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.zack.local",
    },
  });
  await prisma.domainMembership.create({
    data: { userId, domainId: domain.id, role: "owner" },
  });
  return domain.id;
}

/** Creates a Domain with NO membership for the caller (used as the "foreign" domain). */
async function seedForeignDomain(hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "active",
      verificationTarget: "shortener.zack.local",
    },
  });
  return domain.id;
}

/** Creates a Domain + owner DomainMembership that is still "pending" (WR-03 coverage). */
async function seedOwnedPendingDomain(userId: string, hostname: string): Promise<string> {
  const domain = await prisma.domain.create({
    data: {
      hostname,
      type: "subdomain",
      status: "pending",
      verificationTarget: "shortener.zack.local",
    },
  });
  await prisma.domainMembership.create({
    data: { userId, domainId: domain.id, role: "owner" },
  });
  return domain.id;
}

/**
 * The mixed CSV described by the plan's behavior block: one reserved slug,
 * one row targeting a foreign (unauthorized) domain, two identical custom
 * slugs in the same owned domain (the second is an in-file duplicate), and
 * one invalid target URL — plus one fully-valid row. validCount 1,
 * skippedCount 4, with the four distinct LinkSkipReasons.
 */
function buildMixedCsv(ownedHostname: string, foreignHostname: string): string {
  return [
    "ziel_url,slug,domain",
    `https://example.com/reserved,api,${ownedHostname}`,
    `https://example.com/foreign,foreign-slug,${foreignHostname}`,
    `https://example.com/valid,dup-slug,${ownedHostname}`,
    `https://example.com/duplicate,dup-slug,${ownedHostname}`,
    `not-a-valid-url,bad-url-slug,${ownedHostname}`,
  ].join("\n");
}

function buildOverLimitCsv(ownedHostname: string): string {
  const header = "ziel_url,slug,domain";
  const rows = Array.from(
    { length: MAX_IMPORT_ROWS + 1 },
    (_, i) => `https://example.com/over-limit-${i},,${ownedHostname}`,
  );
  return [header, ...rows].join("\n");
}

describe("CSV bulk import (LINK-08, D-01/D-05)", () => {
  beforeEach(async () => {
    vi.mocked(sendMagicLinkEmail).mockClear();
    // Deliberately a plain `prisma.user.upsert` (not `seedInitialAdmin`,
    // which since Phase 9/D-09-01 always sets `accountRole: "admin"`) — this
    // fixture is testing per-domain owner/member scoping (D-01's
    // domain_unauthorized skip reason), not the D-09-02 account-admin
    // bypass, and must default to `accountRole: "member"` (schema default)
    // so it stays denied on domains it holds no membership on.
    await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: { emailVerified: true },
      create: {
        id: "u_import_owner",
        name: "Import Owner",
        email: OWNER_EMAIL,
        emailVerified: true,
      },
    });
  });

  describe("POST /api/links/import/preview", () => {
    it("returns validCount 1 / skippedCount 4 with the 4 distinct skip reasons, and writes ZERO rows (dry-run)", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const ownedDomainId = await seedOwnedDomain(ownerId, "preview-owned.example.com");
      await seedForeignDomain("preview-foreign.example.com");

      const csv = buildMixedCsv("preview-owned.example.com", "preview-foreign.example.com");
      const before = await prisma.link.count();

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/preview",
        headers: { cookie: ownerCookie },
        payload: { csv, defaultDomainId: ownedDomainId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.validCount).toBe(1);
      expect(body.skippedCount).toBe(4);
      const reasons = body.rows
        .filter((row: { valid: boolean }) => !row.valid)
        .map((row: { reason: string }) => row.reason)
        .sort();
      expect(reasons).toEqual(["domain_unauthorized", "duplicate_in_file", "invalid_url", "slug_conflict"]);

      const after = await prisma.link.count();
      expect(after).toBe(before);

      await app.close();
    });

    it("401s with no session", async () => {
      const app = await buildApp({ prisma });

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/preview",
        payload: { csv: "ziel_url,slug,domain\nhttps://example.com,x,owned.example.com" },
      });

      expect(res.statusCode).toBe(401);

      await app.close();
    });
  });

  describe("POST /api/links/import/commit — the D-01 no-bypass proof", () => {
    it("writes exactly validCount rows; zero rows leak for any of the 4 skipped rows", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const ownedDomainId = await seedOwnedDomain(ownerId, "commit-owned.example.com");
      const foreignDomainId = await seedForeignDomain("commit-foreign.example.com");

      const csv = buildMixedCsv("commit-owned.example.com", "commit-foreign.example.com");

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/commit",
        headers: { cookie: ownerCookie },
        payload: { csv, defaultDomainId: ownedDomainId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.importedCount).toBe(1);
      expect(body.skippedCount).toBe(4);

      // No-bypass proof: total row count equals validCount exactly.
      const totalCount = await prisma.link.count();
      expect(totalCount).toBe(1);

      // Zero trace for each of the 4 skipped rows, queried directly.
      const reservedSlugRow = await prisma.link.findFirst({
        where: { domainId: ownedDomainId, slug: "api" },
      });
      expect(reservedSlugRow).toBeNull();

      const foreignDomainRow = await prisma.link.findFirst({ where: { domainId: foreignDomainId } });
      expect(foreignDomainRow).toBeNull();

      const dupSlugRows = await prisma.link.findMany({
        where: { domainId: ownedDomainId, slug: "dup-slug" },
      });
      expect(dupSlugRows).toHaveLength(1);
      expect(dupSlugRows[0]?.targetUrl).toBe("https://example.com/valid");

      const invalidUrlRow = await prisma.link.findFirst({
        where: { targetUrl: "not-a-valid-url" },
      });
      expect(invalidUrlRow).toBeNull();

      await app.close();
    });

    it("401s with no session and writes zero rows", async () => {
      const app = await buildApp({ prisma });

      const before = await prisma.link.count();
      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/commit",
        payload: { csv: "ziel_url,slug,domain\nhttps://example.com,x,owned.example.com" },
      });

      expect(res.statusCode).toBe(401);
      const after = await prisma.link.count();
      expect(after).toBe(before);

      await app.close();
    });
  });

  describe("preview <-> commit parity", () => {
    it("agree on validCount/skippedCount/reasons for the identical CSV", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const ownedDomainId = await seedOwnedDomain(ownerId, "parity-owned.example.com");
      await seedForeignDomain("parity-foreign.example.com");

      const csv = buildMixedCsv("parity-owned.example.com", "parity-foreign.example.com");

      const previewRes = await app.inject({
        method: "POST",
        url: "/api/links/import/preview",
        headers: { cookie: ownerCookie },
        payload: { csv, defaultDomainId: ownedDomainId },
      });
      expect(previewRes.statusCode).toBe(200);
      const previewBody = previewRes.json();

      // Preview wrote nothing, so committing the identical CSV against the
      // identical (unmodified) DB state must report identical numbers.
      const commitRes = await app.inject({
        method: "POST",
        url: "/api/links/import/commit",
        headers: { cookie: ownerCookie },
        payload: { csv, defaultDomainId: ownedDomainId },
      });
      expect(commitRes.statusCode).toBe(200);
      const commitBody = commitRes.json();

      expect(commitBody.importedCount).toBe(previewBody.validCount);
      expect(commitBody.skippedCount).toBe(previewBody.skippedCount);

      const previewReasons = previewBody.rows
        .filter((row: { valid: boolean }) => !row.valid)
        .map((row: { reason: string }) => row.reason)
        .sort();
      const commitReasons = commitBody.rows
        .filter((row: { valid: boolean }) => !row.valid)
        .map((row: { reason: string }) => row.reason)
        .sort();
      expect(commitReasons).toEqual(previewReasons);

      await app.close();
    });
  });

  describe("WR-03: pending domain rows are skipped, never imported", () => {
    it("skips a row whose domain is still pending (not yet verified) and writes zero rows for it", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const pendingDomainId = await seedOwnedPendingDomain(ownerId, "wr03-pending.example.com");

      const csv = [
        "ziel_url,slug,domain",
        "https://example.com/pending-row,wr03-pending-slug,wr03-pending.example.com",
      ].join("\n");

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/commit",
        headers: { cookie: ownerCookie },
        payload: { csv },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.importedCount).toBe(0);
      expect(body.skippedCount).toBe(1);
      expect(body.rows[0].reason).toBe("domain_unauthorized");

      const row = await prisma.link.findFirst({ where: { domainId: pendingDomainId } });
      expect(row).toBeNull();

      await app.close();
    });
  });

  describe("MAX_IMPORT_ROWS cap", () => {
    it("400s a CSV exceeding MAX_IMPORT_ROWS and writes zero rows", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const ownedDomainId = await seedOwnedDomain(ownerId, "over-limit.example.com");

      const csv = buildOverLimitCsv("over-limit.example.com");
      const before = await prisma.link.count();

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/commit",
        headers: { cookie: ownerCookie },
        payload: { csv, defaultDomainId: ownedDomainId },
      });

      expect(res.statusCode).toBe(400);
      const after = await prisma.link.count();
      expect(after).toBe(before);

      await app.close();
    });

    it("IN-04: 400s with a clear header-mismatch error when the CSV columns don't match ziel_url/slug/domain", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);

      // Wrong casing/names — every row would otherwise silently resolve
      // `row.ziel_url` to `undefined` and be reported as `invalid_url`
      // with no hint the real problem is the header.
      const csv = [
        "Ziel_URL,Slug,Domain",
        "https://example.com/mismatched-header,x,",
      ].join("\n");

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/preview",
        headers: { cookie: ownerCookie },
        payload: { csv },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/CSV header does not match/i);

      await app.close();
    });

    it("IN-04: a matching header (even with unrelated extra columns) previews normally", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const ownedDomainId = await seedOwnedDomain(ownerId, "in04-extra-column.example.com");

      const csv = [
        "ziel_url,slug,domain,notes",
        "https://example.com/in04-ok,in04-ok,in04-extra-column.example.com,ignored",
      ].join("\n");

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/preview",
        headers: { cookie: ownerCookie },
        payload: { csv, defaultDomainId: ownedDomainId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().validCount).toBe(1);

      await app.close();
    });

    it("IN-02: 400s a request whose csv field exceeds the explicit CSV_MAX_LENGTH ceiling", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);

      const oversizedCsv = "ziel_url,slug,domain\n".padEnd(1_900_000, "a");

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/preview",
        headers: { cookie: ownerCookie },
        payload: { csv: oversizedCsv },
      });

      expect(res.statusCode).toBe(400);

      await app.close();
    });
  });

  describe("WR-10: partial-import safety on a mid-loop unexpected error", () => {
    it("stops processing, reports partial:true, and never loses the rows already committed", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const ownedDomainId = await seedOwnedDomain(ownerId, "wr10-owned.example.com");

      const csv = [
        "ziel_url,slug,domain",
        "https://example.com/wr10-row1,wr10-row1,wr10-owned.example.com",
        "https://example.com/wr10-row2,wr10-row2,wr10-owned.example.com",
        "https://example.com/wr10-row3,wr10-row3,wr10-owned.example.com",
      ].join("\n");

      // Simulates a transient DB failure on the SECOND row's write: row 1
      // commits normally, row 2's create throws an unexpected (non-P2002)
      // error, row 3 is never attempted.
      const originalCreate = prisma.link.create.bind(prisma.link);
      let createCallCount = 0;
      const createSpy = vi.spyOn(prisma.link, "create").mockImplementation((...args: unknown[]) => {
        createCallCount += 1;
        if (createCallCount === 2) {
          throw new Error("simulated transient DB failure");
        }
        // @ts-expect-error - forwarding the real call's exact arguments through the spy.
        return originalCreate(...args);
      });

      try {
        const res = await app.inject({
          method: "POST",
          url: "/api/links/import/commit",
          headers: { cookie: ownerCookie },
          payload: { csv, defaultDomainId: ownedDomainId },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.partial).toBe(true);
        expect(body.importedCount).toBe(1);

        // Row 1 was committed and durably persisted; rows 2/3 left zero trace.
        const persisted = await prisma.link.findMany({ where: { domainId: ownedDomainId } });
        expect(persisted).toHaveLength(1);
        expect(persisted[0]?.slug).toBe("wr10-row1");
      } finally {
        createSpy.mockRestore();
      }

      await app.close();
    });

    it("a normal full run (no unexpected error) reports partial:false", async () => {
      const app = await buildApp({ prisma });
      const ownerCookie = await signInAs(app, OWNER_EMAIL);
      const ownerId = await resolveSessionUserId(app, ownerCookie);
      const ownedDomainId = await seedOwnedDomain(ownerId, "wr10-normal.example.com");

      const csv = [
        "ziel_url,slug,domain",
        "https://example.com/wr10-normal-row1,wr10-normal-row1,wr10-normal.example.com",
      ].join("\n");

      const res = await app.inject({
        method: "POST",
        url: "/api/links/import/commit",
        headers: { cookie: ownerCookie },
        payload: { csv, defaultDomainId: ownedDomainId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().partial).toBe(false);

      await app.close();
    });
  });
});
