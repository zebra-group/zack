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
import DomainsView from "../views/DomainsView.vue";
import LinkDetailView from "../views/LinkDetailView.vue";
import LinksImportView from "../views/LinksImportView.vue";
import LinksView from "../views/LinksView.vue";
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
      component: LinksView,
      meta: { requiresAuth: true, label: "Links" },
    },
    {
      path: "/links/import",
      name: "links-import",
      component: LinksImportView,
      meta: { requiresAuth: true, label: "Links" },
    },
    {
      path: "/links/:id",
      name: "link-detail",
      component: LinkDetailView,
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
      component: DomainsView,
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
  const authSession = useAuthSessionStore();

  // Rehydrate the session on first navigation (or whenever no user is
  // cached yet) for EITHER a protected route or `/login` itself (IN-03) —
  // `/login` needs the session too, so an already-authenticated user who
  // navigates straight to /login (e.g. a stale bookmark/back-button) gets
  // redirected to the dashboard below instead of re-rendering the Idle
  // login form. fetchSession() never throws — a failed/unreachable request
  // just leaves `user` unauthenticated.
  if ((to.meta.requiresAuth || to.name === "login") && !authSession.user) {
    await authSession.fetchSession();
  }

  // IN-03: symmetric to the requiresAuth guard below — an already-
  // authenticated user has no reason to see the login form. Not a security
  // boundary (T-02-14, same as the guard below): this is a UX redirect
  // only, the session cookie/API access is unaffected either way.
  if (to.name === "login" && authSession.isAuthenticated) {
    return { name: "dashboard" };
  }

  if (!to.meta.requiresAuth) {
    return true;
  }

  if (!authSession.isAuthenticated) {
    return { name: "login" };
  }

  return true;
});

export default router;
