<script setup lang="ts">
/**
 * Root component (Phase 2 replaces the Phase 1 walking-skeleton canary UI).
 * Fetches the session on mount and switches layout: the themeable AppShell
 * for authenticated, non-public routes; a full-screen RouterView for the
 * public auth routes (login/auth-error); and a minimal loading fallback
 * while the session resolves for the first time.
 *
 * The router's own `beforeEach` guard (router/index.ts) already rehydrates
 * the session and redirects unauthenticated users away from protected
 * routes before this component ever renders them (main.ts awaits
 * `router.isReady()` before mount) — the fetch here is a resilience
 * refetch, not the primary auth-gate mechanism.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import AppShell from "./layouts/AppShell.vue";
import { useAuthSessionStore } from "./stores/authSession";

const route = useRoute();
const authSession = useAuthSessionStore();
const sessionChecked = ref(false);

onMounted(async () => {
  await authSession.fetchSession();
  sessionChecked.value = true;
});

const isPublicRoute = computed(() => route.meta.requiresAuth === false);
</script>

<template>
  <div id="app-root">
    <AppShell v-if="authSession.isAuthenticated && !isPublicRoute" />
    <RouterView v-else-if="isPublicRoute" />
    <div v-else-if="!sessionChecked" class="loading">Lädt …</div>
    <RouterView v-else />
  </div>
</template>

<style scoped>
#app-root {
  width: 100%;
  height: 100vh;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: var(--bg);
  color: var(--mut);
  font-family: "Geist", system-ui, sans-serif;
  font-size: 13.5px;
}
</style>
