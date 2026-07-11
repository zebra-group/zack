/**
 * Component test for LoginView (AUTH-01 UI, D-01 neutral Sent copy).
 * Mocks the global `fetch` used by sendMagicLink() — this does not hit a
 * real HTTP server (see 02-04's real integration coverage for the actual
 * neutral-response canary).
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginView from "../src/views/LoginView.vue";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginView", () => {
  it("renders the Idle state with the email input and 'Magic Link senden' CTA", () => {
    const wrapper = mount(LoginView);

    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(wrapper.find('input[type="email"]').attributes("placeholder")).toBe("du@firma.de");
    expect(wrapper.text()).toContain("Magic Link senden");
    expect(wrapper.text()).toContain("Anmelden");
  });

  it("transitions to the neutral Sent state on a successful POST /api/auth/sign-in/magic-link", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: true }), { status: 200 }));

    const wrapper = mount(LoginView);
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
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: true }), { status: 200 }));

    const wrapper = mount(LoginView);
    await wrapper.find('input[type="email"]').setValue("never-allowlisted@example.com");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Link gesendet");
    expect(wrapper.text()).not.toMatch(/nicht (berechtigt|erlaubt|gefunden)/i);
  });

  it("shows an inline error and stays on the Idle state when the request fails", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));

    const wrapper = mount(LoginView);
    await wrapper.find('input[type="email"]').setValue("operator@kurzly.example");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Der Magic Link konnte nicht gesendet werden. Bitte versuche es erneut.",
    );
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
  });

  it("shows the rate-limit copy on a 429 response", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));

    const wrapper = mount(LoginView);
    await wrapper.find('input[type="email"]').setValue("operator@kurzly.example");
    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst.",
    );
  });
});
