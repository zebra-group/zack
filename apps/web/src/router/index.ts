/**
 * Vue Router (AUTH-03 client rehydration, D-03 landing route). The
 * `beforeEach` guard below is a UX convenience only — it is NOT the
 * security boundary (T-02-14). Every protected API route independently
 * re-verifies the httpOnly session cookie server-side on every request
 * (see .planning/phases/02-.../02-RESEARCH.md, Architectural
 * Responsibility Map); a client that bypasses this guard entirely still
 * cannot read protected data without a valid server-side session.
 */
import { createRouter, createWebHistory } from "vue-router";
import { useAuthSessionStore } from "../stores/authSession";
import AuthErrorView from "../views/AuthErrorView.vue";
import ComingSoonView from "../views/ComingSoonView.vue";
import DashboardView from "../views/DashboardView.vue";
import LoginView from "../views/LoginView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: LoginView,
      meta: { requiresAuth: false },
    },
    {
      path: "/auth/error",
      name: "auth-error",
      component: AuthErrorView,
      meta: { requiresAuth: false },
    },
    {
      path: "/",
      name: "dashboard",
      component: DashboardView,
      meta: { requiresAuth: true },
    },
    {
      path: "/links",
      name: "links",
      component: ComingSoonView,
      meta: { requiresAuth: true, label: "Links" },
    },
    {
      path: "/qr-codes",
      name: "qr-codes",
      component: ComingSoonView,
      meta: { requiresAuth: true, label: "QR-Codes" },
    },
    {
      path: "/analytics",
      name: "analytics",
      component: ComingSoonView,
      meta: { requiresAuth: true, label: "Analytics" },
    },
    {
      path: "/domains",
      name: "domains",
      component: ComingSoonView,
      meta: { requiresAuth: true, label: "Domains" },
    },
    {
      path: "/team",
      name: "team",
      component: ComingSoonView,
      meta: { requiresAuth: true, label: "Team" },
    },
  ],
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) {
    return true;
  }

  const authSession = useAuthSessionStore();

  // Rehydrate the session on first navigation (or whenever no user is
  // cached yet). fetchSession() never throws — a failed/unreachable
  // request just leaves `user` unauthenticated.
  if (!authSession.user) {
    await authSession.fetchSession();
  }

  if (!authSession.isAuthenticated) {
    return { name: "login" };
  }

  return true;
});

export default router;
