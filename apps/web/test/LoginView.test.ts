/**
 * Component test for LoginView (AUTH-01 UI, D-01 neutral Sent copy; AUTH-06
 * conditional SSO login affordance, 10-UI-SPEC Surface B / UI-10-07..10).
 * Mocks the global `fetch` used by sendMagicLink()/loadSsoStatus()/
 * signInWithSso() — this does not hit a real HTTP server (see 02-04's real
 * integration coverage for the actual neutral-response canary).
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginView from "../src/views/LoginView.vue";

const mockFetch = vi.fn();

/**
 * Routes the shared `mockFetch` mock by request URL rather than call order —
 * required because LoginView now issues an unconditional GET
 * /api/sso/status on every mount (fail-closed status read), so tests can no
 * longer rely on `mockResolvedValueOnce` FIFO semantics for a single
 * magic-link/oauth2 call.
 */
function fetchRouter(routes: Record<string, () => Response>) {
  return (url: string) => {
    const build = routes[url];
    if (!build) {
      throw new Error(`Unexpected fetch call in test: ${url}`);
    }
    return Promise.resolve(build());
  };
}

const ssoDisabledStatus = () =>
  new Response(
    JSON.stringify({ enabled: false, issuer: null, clientIdMasked: null, callbackPath: "/api/auth/oauth2/callback/oidc" }),
    { status: 200 },
  );

const ssoEnabledStatus = () =>
  new Response(
    JSON.stringify({
      enabled: true,
      issuer: "https://idp.example.com",
      clientIdMasked: "abc…xyz",
      callbackPath: "/api/auth/oauth2/callback/oidc",
    }),
    { status: 200 },
  );

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  // Default: SSO status resolves disabled, so pre-existing magic-link-only
  // tests keep their original fail-closed (no affordance) shape unless a
  // test explicitly overrides the route table.
  mockFetch.mockImplementation(fetchRouter({ "/api/sso/status": ssoDisabledStatus }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginView", () => {
  it("renders the Idle state with the email input and 'Magic Link senden' CTA", async () => {
    const wrapper = mount(LoginView);
    await flushPromises();

    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(wrapper.find('input[type="email"]').attributes("placeholder")).toBe("du@firma.de");
    expect(wrapper.text()).toContain("Magic Link senden");
    expect(wrapper.text()).toContain("Anmelden");
  });

  it("transitions to the neutral Sent state on a successful POST /api/auth/sign-in/magic-link", async () => {
    mockFetch.mockImplementation(
      fetchRouter({
        "/api/sso/status": ssoDisabledStatus,
        "/api/auth/sign-in/magic-link": () => new Response(JSON.stringify({ status: true }), { status: 200 }),
      }),
    );

    const wrapper = mount(LoginView);
    await flushPromises();
    await wrapper.find('input[type="email"]').setValue("operator@kurzly.example");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/auth/sign-in/magic-link",
      expect.objectContaining({
        method: "POST",
        // CR-02: `callbackURL`/`errorCallbackURL` must be sent so
        // better-auth routes a failed verification to the dedicated
        // /auth/error screen (D-05) instead of falling back to "/".
        body: JSON.stringify({
          email: "operator@kurzly.example",
          callbackURL: "/",
          errorCallbackURL: "/auth/error",
        }),
      }),
    );
    expect(wrapper.text()).toContain("Link gesendet");
    expect(wrapper.text()).toContain("operator@kurzly.example");
    expect(wrapper.text()).toContain("15 Minuten gültig");
    // Idle form is gone — only the Sent-state confirmation is visible.
    expect(wrapper.find('input[type="email"]').exists()).toBe(false);
  });

  it("shows the same neutral Sent state regardless of whether the email is allowlisted (D-01)", async () => {
    // The server returns byte-identical 200 responses for allowlisted vs.
    // never-seen emails (proven server-side in 02-04) — the client has no
    // way to distinguish them and must not try to.
    mockFetch.mockImplementation(
      fetchRouter({
        "/api/sso/status": ssoDisabledStatus,
        "/api/auth/sign-in/magic-link": () => new Response(JSON.stringify({ status: true }), { status: 200 }),
      }),
    );

    const wrapper = mount(LoginView);
    await flushPromises();
    await wrapper.find('input[type="email"]').setValue("never-allowlisted@example.com");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Link gesendet");
    expect(wrapper.text()).not.toMatch(/nicht (berechtigt|erlaubt|gefunden)/i);
  });

  it("shows an inline error and stays on the Idle state when the request fails", async () => {
    mockFetch.mockImplementation(
      fetchRouter({
        "/api/sso/status": ssoDisabledStatus,
        "/api/auth/sign-in/magic-link": () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      }),
    );

    const wrapper = mount(LoginView);
    await flushPromises();
    await wrapper.find('input[type="email"]').setValue("operator@kurzly.example");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Der Magic Link konnte nicht gesendet werden. Bitte versuche es erneut.",
    );
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
  });

  it("shows the rate-limit copy on a 429 response", async () => {
    mockFetch.mockImplementation(
      fetchRouter({
        "/api/sso/status": ssoDisabledStatus,
        "/api/auth/sign-in/magic-link": () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
      }),
    );

    const wrapper = mount(LoginView);
    await flushPromises();
    await wrapper.find('input[type="email"]').setValue("operator@kurzly.example");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst.",
    );
  });

  describe("conditional SSO affordance (AUTH-06, 10-UI-SPEC Surface B, UI-10-07..10)", () => {
    it("renders the 'Mit SSO anmelden' affordance with the 'oder' divider and green dot when SSO is enabled", async () => {
      mockFetch.mockImplementation(fetchRouter({ "/api/sso/status": ssoEnabledStatus }));

      const wrapper = mount(LoginView);
      await flushPromises();

      expect(wrapper.text()).toContain("oder");
      expect(wrapper.text()).toContain("Mit SSO anmelden");
      const dot = wrapper.find(".sso-dot");
      expect(dot.exists()).toBe(true);
      expect(dot.attributes("aria-hidden")).toBe("true");
    });

    it("hides the affordance and shows no error when the status fetch fails (fail-closed, UI-10-08)", async () => {
      mockFetch.mockImplementation(
        fetchRouter({
          "/api/sso/status": () => {
            throw new Error("network down");
          },
        }),
      );

      const wrapper = mount(LoginView);
      await flushPromises();

      expect(wrapper.text()).not.toContain("Mit SSO anmelden");
      expect(wrapper.find(".error-inline").exists()).toBe(false);
      // Magic-link stays the only visible path.
      expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    });

    it("hides the affordance when the status fetch resolves not-ok (fail-closed)", async () => {
      mockFetch.mockImplementation(
        fetchRouter({
          "/api/sso/status": () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
        }),
      );

      const wrapper = mount(LoginView);
      await flushPromises();

      expect(wrapper.text()).not.toContain("Mit SSO anmelden");
      expect(wrapper.find(".error-inline").exists()).toBe(false);
    });

    it("does not render the SSO affordance in the Sent state even when SSO is enabled", async () => {
      mockFetch.mockImplementation(
        fetchRouter({
          "/api/sso/status": ssoEnabledStatus,
          "/api/auth/sign-in/magic-link": () => new Response(JSON.stringify({ status: true }), { status: 200 }),
        }),
      );

      const wrapper = mount(LoginView);
      await flushPromises();
      expect(wrapper.text()).toContain("Mit SSO anmelden");

      await wrapper.find('input[type="email"]').setValue("operator@kurzly.example");
      await wrapper.find(".primary-button").trigger("click");
      await flushPromises();

      expect(wrapper.text()).toContain("Link gesendet");
      expect(wrapper.text()).not.toContain("Mit SSO anmelden");
      expect(wrapper.find(".sso-dot").exists()).toBe(false);
    });

    it("clicking 'Mit SSO anmelden' POSTs to /api/auth/sign-in/oauth2 and navigates to the returned authorize URL", async () => {
      const authorizeUrl = "https://idp.example.com/authorize?client_id=abc&state=xyz";
      mockFetch.mockImplementation(
        fetchRouter({
          "/api/sso/status": ssoEnabledStatus,
          "/api/auth/sign-in/oauth2": () => new Response(JSON.stringify({ url: authorizeUrl, redirect: true }), { status: 200 }),
        }),
      );
      // jsdom's window.location.assign is non-configurable, so it cannot be
      // spied on directly (vi.spyOn throws "Cannot redefine property").
      // Replace `window.location` itself with a stub object for this test.
      const originalLocation = window.location;
      const assignMock = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...originalLocation, assign: assignMock },
      });

      const wrapper = mount(LoginView);
      await flushPromises();
      await wrapper.find(".sso-button").trigger("click");
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/auth/sign-in/oauth2",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ providerId: "oidc", callbackURL: "/" }),
        }),
      );
      expect(assignMock).toHaveBeenCalledWith(authorizeUrl);

      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    });
  });
});
