/**
 * authSession Pinia store — the client-side reflection of server-verified
 * session state (T-02-13: this is UX only, NOT a security boundary; every
 * API route independently re-verifies the httpOnly session cookie).
 *
 * The App Shell + router guard (plan 02-06) consume `user`/`isAuthenticated`
 * and call `fetchSession()`/`signOut()`.
 */
import type { SessionUser } from "@kurzly/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getSession, logout } from "../api";

export const useAuthSessionStore = defineStore("authSession", () => {
  const user = ref<SessionUser | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value !== null);

  /**
   * Fetches the current server session. Never throws — a failed/unreachable
   * request just clears `user` (unauthenticated), so callers (e.g. the
   * router guard) can await this unconditionally.
   */
  async function fetchSession(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const session = await getSession();
      user.value = session.user;
    } catch (err) {
      user.value = null;
      error.value = err instanceof Error ? err.message : "Failed to fetch session";
    } finally {
      loading.value = false;
    }
  }

  async function signOut(): Promise<void> {
    try {
      await logout();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to sign out";
    } finally {
      user.value = null;
    }
  }

  return { user, loading, error, isAuthenticated, fetchSession, signOut };
});
