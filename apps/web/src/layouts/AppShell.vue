<script setup lang="ts">
/**
 * App Shell (UI-01/UI-03, D-03): 212px fixed sidebar (logo, full nav,
 * footer with theme toggle + version + user row + logout) beside a
 * scrollable content area. Layout/typography/color values are LOCKED
 * per 02-UI-SPEC.md's "App-Shell — Layout Contract" (Design-Fidelity
 * Waiver — do not round/consolidate).
 *
 * Consumes the theme + authSession Pinia stores built in plan 02-05.
 * Nav active state uses --chip (NOT --accent — accent is reserved for
 * primary actions, per UI-SPEC "Explizit NICHT-Accent").
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthSessionStore } from "../stores/authSession";
import { useThemeStore } from "../stores/theme";

const router = useRouter();
const authSession = useAuthSessionStore();
const theme = useThemeStore();

const navItems = [
  { label: "Dashboard", to: { name: "dashboard" } },
  { label: "Links", to: { name: "links" } },
  { label: "QR-Codes", to: { name: "qr-codes" } },
  { label: "Analytics", to: { name: "analytics" } },
  { label: "Domains", to: { name: "domains" } },
  { label: "Team", to: { name: "team" } },
];

const isDark = computed(() => theme.theme === "dark");
const themeLabel = computed(() => (isDark.value ? "Light Mode" : "Dark Mode"));

const userInitial = computed(() => (authSession.user?.email?.charAt(0) ?? "?").toUpperCase());
const userName = computed(() => authSession.user?.email ?? "");

async function handleLogout(): Promise<void> {
  await authSession.signOut();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="logo-row">
        <div class="logo-mark">K</div>
        <span class="brand-name">Kurzly</span>
      </div>

      <nav class="nav-list">
        <RouterLink
          v-for="item in navItems"
          :key="item.label"
          :to="item.to"
          class="nav-item"
          active-class="nav-item-active"
          exact-active-class="nav-item-active"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <button type="button" class="theme-toggle" @click="theme.toggle">
          <span>{{ themeLabel }}</span>
          <span class="switch-track" :class="{ 'switch-track-dark': isDark }">
            <span class="switch-knob" :class="{ 'switch-knob-dark': isDark }"></span>
          </span>
        </button>

        <div class="version-text">v0.1.0 · self-hosted</div>

        <div class="user-row">
          <div class="avatar">{{ userInitial }}</div>
          <div class="user-info">
            <div class="user-name">{{ userName }}</div>
            <div class="user-role">member</div>
          </div>
          <button type="button" class="logout-btn" title="Abmelden" @click="handleLogout">
            ⏻
          </button>
        </div>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: "Geist", system-ui, sans-serif;
  overflow: hidden;
}

.sidebar {
  width: 212px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--panel);
}

.logo-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 18px 16px 14px;
}

.logo-mark {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1b1b18;
  font-weight: 700;
  font-size: 13px;
}

.brand-name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
}

.nav-item {
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13.5px;
  cursor: pointer;
  background: transparent;
  color: var(--mut);
  font-weight: 400;
  text-decoration: none;
  display: block;
  transition: background 0.15s ease;
}

.nav-item:hover {
  background: var(--hover);
}

.nav-item-active {
  background: var(--chip);
  color: var(--text);
  font-weight: 600;
}

.sidebar-footer {
  margin-top: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--mut);
  cursor: pointer;
  background: none;
  font-family: inherit;
  transition: background 0.15s ease;
}

.theme-toggle:hover {
  background: var(--hover);
}

.switch-track {
  width: 30px;
  height: 16px;
  border-radius: 999px;
  background: var(--border);
  position: relative;
  transition: background 0.15s ease;
  flex: none;
}

.switch-track-dark {
  background: var(--accent);
}

.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--panel);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  transition: left 0.15s ease;
}

.switch-knob-dark {
  left: 16px;
}

.version-text {
  font-size: 11px;
  color: var(--mut);
  padding: 0 4px;
}

.user-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.avatar {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 50%;
  background: var(--chip);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--mut);
}

.user-info {
  min-width: 0;
  flex: 1;
}

.user-name {
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-role {
  font-size: 11px;
  color: var(--mut);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logout-btn {
  flex: none;
  cursor: pointer;
  color: var(--mut);
  display: flex;
  align-items: center;
  padding: 3px;
  background: none;
  border: none;
  font-size: 14px;
  transition: color 0.15s ease;
}

.logout-btn:hover {
  color: var(--text);
}

.content {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}
</style>
