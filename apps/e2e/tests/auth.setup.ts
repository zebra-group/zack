import { test as setup } from "@playwright/test";
import { ADMIN_EMAIL, MEMBER_EMAIL } from "../src/db.js";
import { findMagicLinkUrl } from "../src/mailpit.js";

/**
 * Auth fixture (INFRA-04, T-11-08) — a Playwright "setup project"
 * (`playwright.config.ts`'s `setup` project) that performs ONE real
 * magic-link login round trip per role (admin, member): request the link
 * over real HTTP (with the INFRA-06 rate-limit bypass header, so this never
 * gets throttled by `MAGIC_LINK_RATE_LIMIT` regardless of run count) → read
 * it from Mailpit via the recipient-scoped `findMagicLinkUrl` (never "the
 * latest message", RESEARCH Pitfall 1) → navigate to it (the built app's
 * real `/api/auth/magic-link/verify` endpoint 302-redirects to the
 * dashboard on success) → snapshot `storageState` to
 * `playwright/.auth/<role>.json`.
 *
 * RESEARCH Pitfall 2 is RESOLVED for this repo: `apps/web` has zero
 * sessionStorage and zero auth-related localStorage — better-auth's session
 * lives entirely in an httpOnly cookie, re-derived via
 * `GET /api/auth/get-session` on every router-guard navigation. Cookie-only
 * `storageState` capture is therefore provably sufficient; this file does
 * NOT add any sessionStorage handling.
 *
 * `chromium-admin`/`chromium-member` (playwright.config.ts) declare
 * `dependencies: ["setup"]` and load the resulting files via
 * `use.storageState` — every downstream authenticated spec (Phases 13-17)
 * reuses these instead of repeating this round trip per spec file.
 */

interface RoleFixture {
  role: "admin" | "member";
  email: string;
  storagePath: string;
}

const ROLE_FIXTURES: RoleFixture[] = [
  { role: "admin", email: ADMIN_EMAIL, storagePath: "playwright/.auth/admin.json" },
  { role: "member", email: MEMBER_EMAIL, storagePath: "playwright/.auth/member.json" },
];

for (const { role, email, storagePath } of ROLE_FIXTURES) {
  setup(`authenticate as ${role}`, async ({ page, request }) => {
    // Request the magic link over real HTTP, sending the INFRA-06 bypass
    // header (never rely on the UI form for this — the form itself is
    // already covered by Phase 13's dedicated login-UI spec; this fixture
    // only needs the round trip to actually authenticate the session).
    const bypassSecret = process.env.E2E_RATE_LIMIT_BYPASS_SECRET;
    const magicLinkResponse = await request.post("/api/auth/sign-in/magic-link", {
      data: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
      headers: bypassSecret ? { "x-e2e-bypass": bypassSecret } : {},
    });
    if (!magicLinkResponse.ok()) {
      throw new Error(
        `auth.setup.ts: magic-link request for ${email} (${role}) failed with ` +
          `status ${magicLinkResponse.status()}`,
      );
    }

    // Recipient-scoped retrieval (src/mailpit.ts) — hard-asserts the
    // retrieved message's To address equals `email` before returning a
    // link, so the admin round trip can never consume the member's
    // concurrently in-flight email or vice versa.
    const magicLinkUrl = await findMagicLinkUrl(email);

    // Following the real link exercises the actual verify endpoint and its
    // 302 redirect to the dashboard (callbackURL: "/") — this IS the
    // authenticated session being established, not a simulated one.
    await page.goto(magicLinkUrl);

    // Wait for the authenticated App Shell to actually render (the
    // "Dashboard" nav entry is present for every role, unlike "Team" which
    // is admin-only — AppShell.vue's visibleNavItems) before snapshotting
    // storageState, so a slow session-cookie/session-fetch race can never
    // produce an unauthenticated storageState file.
    await page.getByRole("link", { name: "Dashboard" }).waitFor();

    await page.context().storageState({ path: storagePath });
  });
}
