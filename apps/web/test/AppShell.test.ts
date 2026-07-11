/**
 * Component test for AppShell (UI-01/UI-03 structure, AUTH-04 from-every-page
 * logout, theme toggle wiring). Stubs RouterLink/RouterView (a real router
 * is not needed to assert the shell's own markup/behavior) and seeds the
 * authSession + theme Pinia stores directly.
 */
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "../src/layouts/AppShell.vue";
import { useAuthSessionStore } from "../src/stores/authSession";
import { useThemeStore } from "../src/stores/theme";

const pushMock = vi.fn();

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: () => ({ push: pushMock }),
  };
});

vi.mock("../src/api", () => ({
  getSession: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}));

function mountAppShell() {
  return mount(AppShell, {
    global: {
      stubs: {
        RouterLink: { template: "<a><slot /></a>" },
        RouterView: { template: "<div />" },
      },
    },
  });
}

describe("AppShell", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    pushMock.mockClear();

    const authSession = useAuthSessionStore();
    authSession.user = { id: "u1", email: "operator@kurzly.example" };
  });

  it("renders the 212px sidebar with all six nav labels", () => {
    const wrapper = mountAppShell();

    expect(wrapper.find(".sidebar").exists()).toBe(true);
    for (const label of ["Dashboard", "Links", "QR-Codes", "Analytics", "Domains", "Team"]) {
      expect(wrapper.text()).toContain(label);
    }
  });

  it("calls theme.toggle() when the theme toggle is clicked", async () => {
    const theme = useThemeStore();
    const toggleSpy = vi.spyOn(theme, "toggle");

    const wrapper = mountAppShell();
    await wrapper.find(".theme-toggle").trigger("click");

    expect(toggleSpy).toHaveBeenCalledTimes(1);
  });

  it("calls authSession.signOut() and routes to login when the logout control is clicked", async () => {
    const authSession = useAuthSessionStore();
    const signOutSpy = vi.spyOn(authSession, "signOut");

    const wrapper = mountAppShell();
    await wrapper.find(".logout-btn").trigger("click");
    await wrapper.vm.$nextTick();

    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith({ name: "login" });
  });
});
