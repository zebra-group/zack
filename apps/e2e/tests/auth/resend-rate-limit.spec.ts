import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

/**
 * AUTH-E2E-07 (13-06-PLAN.md) — proves the resend rate-limit UX: a burst of
 * magic-link requests that trips the REAL `@fastify/rate-limit` limiter
 * (`MAGIC_LINK_RATE_LIMIT`, `plugins/rateLimit.ts`, 5 req/15min, IP-keyed)
 * surfaces the exact German copy in the login UI, rather than failing
 * silently.
 *
 * This is the ONE magic-link-sending spec in this phase that deliberately
 * does NOT send the INFRA-06 `x-e2e-bypass` header anywhere — every sibling
 * magic-link spec (round-trip, token-rejection, invite-only-denial,
 * `auth.setup.ts`) sends that header specifically so it never contends this
 * spec's rate-limit bucket. Because the limiter is IP-keyed (not
 * email-keyed, `rateLimit.ts`), the burst below is what actually trips the
 * bucket — the dedicated email only keeps this spec's own traffic from
 * colliding with any other spec that happens to target the same recipient
 * (it never does, but the convention is kept for consistency with every
 * other spec in this phase).
 *
 * Per `plugins/rateLimit.ts`'s route registration
 * (`config: { rateLimit: MAGIC_LINK_RATE_LIMIT }` on
 * `POST /api/auth/sign-in/magic-link`, `routes/auth.ts`), the limiter's
 * `onRequest` hook runs BEFORE the route handler — so the bucket counts
 * every request to this route regardless of whether the target email is
 * allowlisted. No `User` fixture is created here; the email's existence (or
 * lack of it) is irrelevant to tripping the limiter.
 *
 * Pre-exhausts the bucket via 6 direct `page.request.post` calls (no
 * bypass header) BEFORE driving the real UI, so the UI-driven request is
 * guaranteed to be the one that observes the 429 — avoids racing
 * `LoginView.vue`'s own idle -> "sent" state transition on a first success.
 *
 * WR-02 (13-REVIEW.md): this test runs in the `auth` Playwright project,
 * which has no `dependencies` and inherits the top-level `fullyParallel:
 * true` (`playwright.config.ts`) — so this spec's 6-request burst against
 * the IP-keyed magic-link limiter can execute concurrently with every
 * sibling magic-link-sending spec in this same project (all of which DO
 * send `x-e2e-bypass`). This is safe, verified by reading
 * `@fastify/rate-limit@11.1.0`'s own source (`index.js`, the
 * `allowList`-check branch inside its request handler): when
 * `params.allowList(req, key)` returns `true`, the function returns
 * `{ isAllowed: true, key }` immediately, BEFORE any bucket-counting logic
 * (`store.incr`) runs. So a bypassed sibling request is excluded from the
 * shared IP bucket's count entirely — it can neither dilute this spec's
 * own attempt to trip the bucket, nor get spuriously 429'd once this
 * spec's burst has tripped it. `apps/api/src/plugins/rateLimit.ts`'s
 * `allowList` callback (`request.headers["x-e2e-bypass"] === bypassSecret`)
 * is exactly this kind of function-form `allowList`, so this guarantee
 * applies here. If a future `@fastify/rate-limit` major changes this
 * short-circuit ordering, this spec (and its siblings) would start
 * flaking intermittently under `fullyParallel` — re-verify this comment's
 * claim against the installed version if that happens.
 */
test("tripped rate limit surfaces the exact German UI copy, not a silent failure (AUTH-E2E-07)", async ({
  page,
}) => {
  const email = `ratelimit-${randomUUID().slice(0, 8)}@e2e.kurzly.local`;

  // Trip the bucket: MAGIC_LINK_RATE_LIMIT.max is 5, so a 6th same-IP
  // request within the 15-minute window is guaranteed to 429. NO
  // `x-e2e-bypass` header is sent — this is the whole point of the spec.
  for (let i = 0; i < 6; i += 1) {
    await page.request.post("/api/auth/sign-in/magic-link", {
      data: { email, callbackURL: "/", errorCallbackURL: "/auth/error" },
    });
  }

  // Drive the REAL login UI once the bucket is already over the limit —
  // this fetch (LoginView.vue's `sendMagicLink`) hits the same tripped
  // bucket and must observe a 429.
  await page.goto("/login");
  await page.getByPlaceholder("du@firma.de").fill(email);
  await page.getByRole("button", { name: "Magic Link senden" }).click();

  // Assert the exact, verbatim German copy — not a paraphrase.
  const errorLocator = page.locator(".error-inline");
  await expect(errorLocator).toBeVisible();
  await expect(errorLocator).toHaveText(
    "Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst.",
  );

  // Confirm the form did NOT transition to the "Link gesendet" (sent)
  // state — the 429 branch in `sendMagicLink` returns before `state` is
  // ever set to "sent", so the error renders beneath the still-visible send
  // button/input, not behind the sent-state confirmation screen.
  await expect(page.getByRole("button", { name: "Magic Link senden" })).toBeVisible();
  await expect(page.getByText("Link gesendet")).toHaveCount(0);
});
