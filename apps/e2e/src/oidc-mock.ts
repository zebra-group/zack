/**
 * Mock OIDC IdP control client (13-01-PLAN.md's `apps/e2e/oidc-mock/server.mjs`,
 * T-13-01/T-13-02) — a thin fetch wrapper over the mock IdP's test-only
 * `PUT`/`DELETE /__test__/profile` control routes, mirroring `mailpit.ts`'s
 * shape (env-configured base URL, clear thrown errors, no ad hoc scattered
 * fetches).
 *
 * `OIDC_MOCK_CONTROL_URL` defaults to `http://localhost:9000` — the
 * host-published port `docker-compose.e2e.yml`/`scripts/e2e-compose.sh`
 * (13-01) exposes for the mock IdP's Koa app. This is the SAME server the
 * app container reaches internally as `http://oidc-mock:9000` — this
 * client always speaks to the host-published address, since it (like the
 * Playwright test runner itself) is never inside the compose network.
 *
 * Route paths and body shape here MUST stay byte-identical to
 * `apps/e2e/oidc-mock/server.mjs`'s `router.put("/__test__/profile", ...)`/
 * `router.delete("/__test__/profile", ...)` handlers — the two files are
 * two ends of one contract (this plan's `key_links`).
 */

const OIDC_MOCK_CONTROL_URL = process.env.OIDC_MOCK_CONTROL_URL ?? "http://localhost:9000";

/**
 * The next SSO subject's claims. Mirrors `server.mjs`'s own `nextProfile`
 * shape exactly: `sub`/`email` are always present on the mock's own state
 * (defaulted server-side if omitted here), `emailVerified`/`extraClaims`
 * are optional overrides.
 */
export interface OidcProfile {
  sub: string;
  email: string;
  emailVerified?: boolean;
  extraClaims?: Record<string, unknown>;
}

/**
 * Sets the mock IdP's next authenticated subject via `PUT /__test__/profile`.
 * Every subsequent authorization_code round trip (until the next
 * `setOidcProfile`/`resetOidcProfile` call) resolves to this profile's
 * `sub`/`email`/`emailVerified`/`extraClaims`.
 *
 * Throws a descriptive error if the mock does not respond `204`.
 */
export async function setOidcProfile(profile: OidcProfile): Promise<void> {
  const response = await fetch(`${OIDC_MOCK_CONTROL_URL}/__test__/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });

  if (response.status !== 204) {
    throw new Error(
      `setOidcProfile: PUT ${OIDC_MOCK_CONTROL_URL}/__test__/profile returned ` +
        `${response.status} (expected 204) — ${await response.text()}`,
    );
  }
}

/**
 * Resets the mock IdP back to its own server-side `DEFAULT_PROFILE` via
 * `DELETE /__test__/profile` — call this in an `afterEach`/`test.afterAll`
 * so one spec's admin-shaped claims can never leak into another spec's
 * assertions against the mock's single global profile state.
 *
 * Throws a descriptive error if the mock does not respond `204`.
 */
export async function resetOidcProfile(): Promise<void> {
  const response = await fetch(`${OIDC_MOCK_CONTROL_URL}/__test__/profile`, {
    method: "DELETE",
  });

  if (response.status !== 204) {
    throw new Error(
      `resetOidcProfile: DELETE ${OIDC_MOCK_CONTROL_URL}/__test__/profile returned ` +
        `${response.status} (expected 204) — ${await response.text()}`,
    );
  }
}
