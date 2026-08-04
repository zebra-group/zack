/**
 * Component test for the theme Pinia store (UI-02/UI-03): toggling flips
 * light/dark, sets `body[data-theme]`, and persists the choice to
 * `localStorage["zack-theme"]`.
 */
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../src/stores/theme";

beforeEach(() => {
  localStorage.clear();
  document.body.removeAttribute("data-theme");
  setActivePinia(createPinia());
});

describe("theme store", () => {
  it("defaults to light and leaves data-theme empty (no dark class applied)", () => {
    const store = useThemeStore();

    expect(store.theme).toBe("light");
    expect(document.body.getAttribute("data-theme")).toBe("");
  });

  it("toggle() flips to dark, sets body[data-theme=dark], and persists to localStorage", () => {
    const store = useThemeStore();

    store.toggle();

    expect(store.theme).toBe("dark");
    expect(document.body.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("zack-theme")).toBe("dark");
  });

  it("toggle() twice returns to light and clears the attribute + persists light", () => {
    const store = useThemeStore();

    store.toggle();
    store.toggle();

    expect(store.theme).toBe("light");
    expect(document.body.getAttribute("data-theme")).toBe("");
    expect(localStorage.getItem("zack-theme")).toBe("light");
  });

  it("reads a persisted dark theme from localStorage on store creation", () => {
    localStorage.setItem("zack-theme", "dark");

    const store = useThemeStore();

    expect(store.theme).toBe("dark");
    expect(document.body.getAttribute("data-theme")).toBe("dark");
  });
});
