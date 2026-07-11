/**
 * Theme Pinia store (UI-02/UI-03). Holds light/dark state, applies it to
 * `<body data-theme>` (drives the LOCKED CSS custom properties in
 * tokens.css), and persists the choice to localStorage under
 * `kurzly-theme`.
 *
 * The App Shell (plan 02-06) and main.ts (pre-paint FOUC guard) both
 * consume this store's `theme`/`toggle()`.
 */
import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type Theme = "light" | "dark";

const STORAGE_KEY = "kurzly-theme";

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.body.dataset.theme = theme === "dark" ? "dark" : "";
}

export const useThemeStore = defineStore("theme", () => {
  const theme = ref<Theme>(readStoredTheme());

  // Apply immediately on store creation so a store that's instantiated
  // after the pre-paint main.ts snippet stays in sync (and so unit tests
  // that construct the store directly still see the DOM attribute set).
  applyTheme(theme.value);

  function toggle(): void {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  // `flush: "sync"` so the DOM attribute + localStorage stay synchronously
  // consistent with `theme.value` immediately after toggle() — callers
  // (including tests) never observe a stale attribute across a microtask.
  watch(
    theme,
    (next) => {
      applyTheme(next);
      localStorage.setItem(STORAGE_KEY, next);
    },
    { flush: "sync" },
  );

  return { theme, toggle };
});
