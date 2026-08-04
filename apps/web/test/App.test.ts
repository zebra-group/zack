/**
 * Component test for App.vue's layout switching (Phase 2 replaces the
 * Phase 1 walking-skeleton canary UI tested here previously). Uses the
 * real router (router/index.ts) + a real Pinia instance, mocking the
 * global `fetch` that api.ts's getSession() calls under the hood — this
 * does not hit a real HTTP server (see 02-04's integration coverage for
 * the actual server-side session behavior).
 */
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import router from "../src/router";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App.vue", () => {
  it("redirects an unauthenticated session to /login and renders the full-screen LoginView (no shell)", async () => {
    // Each call gets a fresh Response — its body can only be read once.
    mockFetch.mockImplementation(() => Promise.resolve(new Response("null", { status: 200 })));

    const pinia = createPinia();
    setActivePinia(pinia);
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, {
      global: { plugins: [pinia, router] },
    });
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("login");
    expect(wrapper.text()).toContain("Anmelden");
    expect(wrapper.find(".sidebar").exists()).toBe(false);
  });

  it("renders the AppShell + Dashboard for an authenticated session", async () => {
    // Each call gets a fresh Response — its body can only be read once.
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ session: {}, user: { id: "u1", email: "operator@zack.example" } }),
          { status: 200 },
        ),
      ),
    );

    const pinia = createPinia();
    setActivePinia(pinia);
    await router.push("/");
    await router.isReady();

    const wrapper = mount(App, {
      global: { plugins: [pinia, router] },
    });
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("dashboard");
    expect(wrapper.find(".sidebar").exists()).toBe(true);
    expect(wrapper.text()).toContain("Übersicht");
  });

  it("IN-03: redirects an already-authenticated session away from /login to the dashboard", async () => {
    // Each call gets a fresh Response — its body can only be read once.
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ session: {}, user: { id: "u1", email: "operator@zack.example" } }),
          { status: 200 },
        ),
      ),
    );

    const pinia = createPinia();
    setActivePinia(pinia);
    await router.push("/login");
    await router.isReady();

    const wrapper = mount(App, {
      global: { plugins: [pinia, router] },
    });
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("dashboard");
    expect(wrapper.find(".sidebar").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Magic Link senden");
  });
});
