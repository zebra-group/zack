# Phase 2: Magic-Link Auth, App Shell & Domain Authorization Core - Pattern Map

**Mapped:** 2026-07-11
**Files analyzed:** 21 (10 new, 11 modified/existing)
**Analogs found:** 18 / 21

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api/src/app.ts` | controller | request-response | itself (Phase 1) | exact |
| `apps/api/src/env.ts` | config | transform | itself (Phase 1) | exact |
| `apps/api/src/server.ts` | config | transform | itself (Phase 1) | exact |
| `apps/api/src/lib/auth.ts` | service | request-response | `apps/api/src/routes/canary.ts` | role-match |
| `apps/api/src/lib/authorization.ts` | service/utility | CRUD | `apps/api/src/routes/canary.ts` | role-match |
| `apps/api/src/routes/auth.ts` | controller | request-response | `apps/api/src/routes/canary.ts` | exact |
| `apps/api/src/plugins/helmet.ts` | middleware | request-response | `apps/api/src/plugins/cors.ts` | exact |
| `apps/api/src/plugins/rateLimit.ts` | middleware | request-response | `apps/api/src/plugins/cors.ts` | exact |
| `apps/api/prisma/schema.prisma` | model | CRUD | itself (Phase 1) | exact |
| `apps/api/test/authorization.test.ts` | test | CRUD | `apps/api/test/db.test.ts` + `apps/api/test/setupFileEach.ts` | exact |
| `apps/api/test/auth.integration.test.ts` | test | request-response | `apps/api/test/server.integration.test.ts` | exact |
| `apps/web/src/stores/authSession.ts` | store | transform/state | no analog (new pattern) | no-match |
| `apps/web/src/stores/theme.ts` | store | transform/state | no analog (new pattern) | no-match |
| `apps/web/src/router/index.ts` | hook | transform | no analog (new pattern) | no-match |
| `apps/web/src/views/LoginView.vue` | component | request-response | `apps/web/src/App.vue` | partial |
| `apps/web/src/views/AuthErrorView.vue` | component | request-response | `apps/web/src/App.vue` | partial |
| `apps/web/src/views/DashboardView.vue` | component | request-response | `apps/web/src/App.vue` | partial |
| `apps/web/src/views/ComingSoonView.vue` | component | request-response | `apps/web/src/App.vue` | partial |
| `apps/web/src/layouts/AppShell.vue` | layout | request-response | `apps/web/src/App.vue` | partial |
| `apps/web/src/App.vue` | component | request-response | itself (Phase 1) | exact |
| `packages/shared/src/index.ts` | model | transform | itself (Phase 1) | exact |

---

## Pattern Assignments

### Backend (Fastify/API)

#### `apps/api/src/app.ts` (controller, request-response)

**Analog:** `apps/api/src/app.ts` (Phase 1, extended)

**Extension context:** Phase 1's buildApp() factory establishes route-order rules. Phase 2 inserts helmet, rate-limit, and auth route registration into this sequence before `registerStatic()`.

**Existing imports pattern** (lines 21-30):
```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma as defaultPrisma } from "./db.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { canaryRoute } from "./routes/canary.js";
```

**Existing BuildAppOptions pattern** (lines 34-45):
```typescript
export type BuildAppOptions = {
  nodeEnv?: string;
  publicDir?: string;
  prisma?: PrismaClient;
};
```

**New registration order** (extend lines 56-67, insert before `registerStatic`):
```typescript
await registerCors(app, nodeEnv);
await app.register(registerHelmet);      // NEW — Phase 2
await app.register(registerRateLimit);   // NEW — Phase 2

await app.register(
  async (apiScope) => {
    await apiScope.register(canaryRoute(prisma));
    await apiScope.register(authRoute);  // NEW — Phase 2, no prisma arg (auth is singleton)
  },
  { prefix: "/api" },
);
```

**Route registration order (LOCKED, Phase 1 rule + Phase 2 extension):**
1. Dev-only CORS (unchanged)
2. @fastify/helmet (NEW)
3. @fastify/rate-limit (NEW, global default, will be tightened per-route in rateLimit.ts)
4. API routes under `/api` prefix: canary (unchanged), auth (NEW)
5. Health route (unchanged)
6. Redirect stub (unchanged)
7. Static file serving (unchanged)
8. Not-found handler (unchanged)

---

#### `apps/api/src/env.ts` (config, transform)

**Analog:** `apps/api/src/env.ts` (Phase 1, extended)

**Extend envSchema** (add to existing schema, lines 23-46):
```typescript
export const envSchema = z.object({
  // ... existing fields unchanged ...
  INITIAL_ADMIN_EMAIL: z.email(),  // NEW — Phase 2, D-01 seeding
});
```

**Rationale:** Use the existing fail-fast pattern; add `INITIAL_ADMIN_EMAIL` as a required `.email()` validation. This becomes mandatory at boot, so the operator cannot forget to set it when deploying a fresh instance (D-01 bootstrapping safety).

---

#### `apps/api/src/server.ts` (config, transform)

**Analog:** `apps/api/src/server.ts` (Phase 1, extended)

**Existing boot sequence** (lines 21-35):
```typescript
import "dotenv/config";
import { loadEnv } from "./env.js";

const env = loadEnv();
const { buildApp } = await import("./app.js");
const app = await buildApp({ nodeEnv: env.NODE_ENV });

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

**New seeding logic** (insert after `loadEnv()`, before `buildApp()`):
```typescript
const env = loadEnv();

// NEW — Phase 2: Seed INITIAL_ADMIN_EMAIL user at boot
const { seedInitialAdmin } = await import("./lib/admin-seed.js");
await seedInitialAdmin(env.INITIAL_ADMIN_EMAIL);

const { buildApp } = await import("./app.js");
```

**Note:** The `seedInitialAdmin` function (not shown here, but needed in `apps/api/src/lib/admin-seed.ts`) should:
- Check if a User with `INITIAL_ADMIN_EMAIL` already exists
- If not, upsert one with `emailVerified: true` and a global admin flag (schema decision, flagged in RESEARCH.md Open Question 3)
- Return silently on second+ boots (idempotent)

---

#### `apps/api/src/lib/auth.ts` (service, request-response)

**Analog:** `apps/api/src/routes/canary.ts` (factory pattern) + RESEARCH.md Pattern 1 (better-auth instance wiring)

**No direct Phase 1 analog for better-auth config.** Use research code sample as base:

**Core better-auth instance** (from RESEARCH.md code example, lines 429-454):
```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins";
import { prisma } from "../db.js";
import { mailer } from "./mailer.js";
import { isEmailAllowed } from "./allowlist.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  session: {
    expiresIn: 60 * 60 * 24 * 7,  // 7d — default, satisfies AUTH-03
    updateAge: 60 * 60 * 24,       // 1d sliding refresh
  },
  plugins: [
    magicLink({
      expiresIn: 900,  // 15 min — AUTH-02
      disableSignUp: true,  // D-01
      sendMagicLink: async ({ email, url }) => {
        if (!(await isEmailAllowed(prisma, email))) return;  // neutral no-op
        await mailer.sendMail({ 
          to: email, 
          subject: "Dein Kurzly Magic Link", 
          html: url 
        });
      },
    }),
  ],
});
```

**Critical constraints:**
- Import `prisma` from `db.ts` EXACTLY (not a second client instance) — mirroring Phase 1's singleton pattern
- `prismaAdapter` must come from bundled `better-auth/adapters/prisma`, NOT the separate npm package (flagged in RESEARCH.md A1)
- `disableSignUp: true` + in-callback allowlist gate implements D-01's neutral response

---

#### `apps/api/src/lib/authorization.ts` (service/utility, CRUD)

**Analog:** `apps/api/test/db.test.ts` (test pattern using setupFileEach's transaction-wrapped Prisma) + `apps/api/src/routes/canary.ts` (DB query pattern)

**Core authorization helpers** (RESEARCH.md Pattern 4, lines 329-362):
```typescript
import type { PrismaClient } from "../generated/prisma/client.js";

export const ROLE_RANK = { member: 0, admin: 1, owner: 2 } as const;
export type Role = keyof typeof ROLE_RANK;

export class ForbiddenError extends Error {}

export async function requireDomainAccess(
  prisma: PrismaClient,
  userId: string,
  domainId: string,
  minRole: Role,
): Promise<void> {
  const membership = await prisma.domainMembership.findUnique({
    where: { userId_domainId: { userId, domainId } },
  });
  if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new ForbiddenError(
      `User ${userId} lacks ${minRole}+ access to domain ${domainId}`,
    );
  }
}

export async function scopedDomainIds(
  prisma: PrismaClient,
  userId: string,
): Promise<string[]> {
  const memberships = await prisma.domainMembership.findMany({
    where: { userId },
    select: { domainId: true },
  });
  return memberships.map((m) => m.domainId);
}
```

**Constraints:**
- Keep signature exactly stable (CONTEXT.md Integration Points) — Phases 3–9 will depend on this
- Both functions take `prisma` as first arg, mirroring the canary-route pattern for testability
- No direct DB connection code — all queries go through the passed Prisma client
- Phase 2 only builds + unit-tests the helpers; zero routes yet depend on them

---

#### `apps/api/src/routes/auth.ts` (controller, request-response)

**Analog:** `apps/api/src/routes/canary.ts` (lines 18-35, route factory pattern)

**Catch-all auth route handler** (RESEARCH.md Pattern 1, lines 259-288):
```typescript
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth.js";

export async function authRoute(app: FastifyInstance): Promise<void> {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
```

**Notes:**
- Exported as a named async function (not a factory) so `app.ts` can call it directly
- Must be registered BEFORE `registerStatic()` in `app.ts` (route-order rule from Phase 1)
- Handles all better-auth endpoints (`/api/auth/sign-in/magic-link`, `/api/auth/magic-link/verify?token=...`, `/api/auth/sign-out`, etc.) via the single catch-all

---

#### `apps/api/src/plugins/helmet.ts` (middleware, request-response)

**Analog:** `apps/api/src/plugins/cors.ts` (lines 1-26, plugin registration pattern)

**Pattern:** Conditional registration function, registers `@fastify/helmet` with CSP tuning for Google Fonts:

```typescript
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

export async function registerHelmet(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "fonts.googleapis.com"],
        fontSrc: ["fonts.gstatic.com"],
        scriptSrc: ["'self'"],
      },
    },
  });
}
```

**Rationale:**
- Follows the exact registration-function pattern as `registerCors()`
- CSP explicitly allows Google Fonts (Geist) per UI-SPEC (Pitfall 4, RESEARCH.md lines 404-408)
- Solves WR-04 from Phase 1 code review (security baseline)

---

#### `apps/api/src/plugins/rateLimit.ts` (middleware, request-response)

**Analog:** `apps/api/src/plugins/cors.ts` (registration pattern) + RESEARCH.md Pitfall 3 (per-route tightening)

**Pattern:** Global registration with per-route override on `/api/auth/sign-in/magic-link`:

```typescript
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  // Global default: 100 requests per 15 minutes
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "15 minutes",
  });

  // Per-route tightening: magic-link endpoint gets 5 requests per 15 minutes (email-bombing mitigation)
  // Note: Per-route config is applied in the auth route handler itself via route-level decorator
  // or in this plugin via a hook that checks the URL
}
```

**Notes:**
- Phase 2 RESEARCH.md (Pitfall 3) flags that a global default alone is insufficient
- Magic-link endpoint needs tighter limit (e.g., 5 per 15 min) to stop email-bombing effectively
- Per-route config syntax varies by @fastify/rate-limit version — defer exact implementation to plan's verification step, but ensure the intent is captured: global permissive + auth endpoints tight
- Solves WR-02 from Phase 1 code review (rate-limiting baseline)

---

#### `apps/api/prisma/schema.prisma` (model, CRUD)

**Analog:** `apps/api/prisma/schema.prisma` (Phase 1, extended)

**Existing generator + datasource** (lines 8-21, unchanged):
```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

**Keep PersistenceCanary model (unchanged).**

**New models added by Phase 2** (better-auth tables + minimal domain schema):

After running `npx @better-auth/cli generate`, the CLI will auto-append these tables to the schema:
- `User` (email, name, emailVerified, etc.)
- `Session` (userId, expiresAt, etc.)
- `Account` (userId, provider, etc. — even for magic-link, better-auth creates this)
- `Verification` (identifier, token, expiresAt — magic-link tokens stored here)

**Phase 2 must add manually** (not generated by CLI):
```prisma
model Domain {
  id           String   @id @default(cuid())
  createdAt    DateTime @default(now())
  // Minimal schema — full lifecycle (name, DNS, TLS) added Phase 3
}

model DomainMembership {
  userId   String
  domainId String
  role     String  // "member" | "admin" | "owner" — use enum or String, defer to planner
  
  user     User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  domain   Domain  @relation(fields: [domainId], references: [id], onDelete: Cascade)
  
  @@id([userId, domainId])  // Composite PK: one role per user per domain
}
```

**Migration:** After editing schema.prisma, run:
```bash
pnpm --filter @kurzly/api exec prisma migrate dev --name "add_auth_and_domain_models"
```

---

#### `apps/api/test/authorization.test.ts` (test, CRUD)

**Analog:** `apps/api/test/db.test.ts` (unit test pattern) + `apps/api/test/setupFileEach.ts` (transaction-wrapped Prisma) + `apps/api/test/server.integration.test.ts` (test structure)

**Test structure** (using `setupFileEach.ts` transaction-wrapped prisma):

```typescript
import { describe, expect, it } from "vitest";
import { prisma } from "./setupFileEach.js";
import {
  requireDomainAccess,
  scopedDomainIds,
  ForbiddenError,
} from "../src/lib/authorization.js";

describe("Authorization core (D-02)", () => {
  // Each test runs inside a BEGIN/ROLLBACK transaction via setupFileEach
  
  it("requireDomainAccess allows owner-level access", async () => {
    // Arrange: seed a user, domain, and membership
    const user = await prisma.user.create({ data: { email: "owner@test" } });
    const domain = await prisma.domain.create({ data: {} });
    await prisma.domainMembership.create({
      data: { userId: user.id, domainId: domain.id, role: "owner" },
    });
    
    // Act: check access with minRole "admin"
    // Assert: should not throw (owner >= admin)
    await expect(
      requireDomainAccess(prisma, user.id, domain.id, "admin"),
    ).resolves.toBeUndefined();
  });

  it("requireDomainAccess denies access below minRole", async () => {
    const user = await prisma.user.create({ data: { email: "member@test" } });
    const domain = await prisma.domain.create({ data: {} });
    await prisma.domainMembership.create({
      data: { userId: user.id, domainId: domain.id, role: "member" },
    });
    
    await expect(
      requireDomainAccess(prisma, user.id, domain.id, "admin"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("scopedDomainIds returns exactly the domains a user is a member of", async () => {
    const user = await prisma.user.create({ data: { email: "user@test" } });
    const domain1 = await prisma.domain.create({ data: {} });
    const domain2 = await prisma.domain.create({ data: {} });
    
    await prisma.domainMembership.create({
      data: { userId: user.id, domainId: domain1.id, role: "owner" },
    });
    await prisma.domainMembership.create({
      data: { userId: user.id, domainId: domain2.id, role: "member" },
    });
    
    const ids = await scopedDomainIds(prisma, user.id);
    
    expect(ids).toEqual(expect.arrayContaining([domain1.id, domain2.id]));
    expect(ids).toHaveLength(2);
  });
});
```

**Key patterns:**
- Import `prisma` from `setupFileEach.js` (transaction-wrapped, max:1 pool)
- Each test is wrapped in BEGIN/ROLLBACK automatically, so data doesn't leak
- Use `await expect(...).resolves/rejects` for async assertions
- No manual cleanup needed (ROLLBACK handles it)

---

#### `apps/api/test/auth.integration.test.ts` (test, request-response)

**Analog:** `apps/api/test/server.integration.test.ts` (lines 1-50, integration test pattern) + `apps/api/test/canary.integration.test.ts` (if exists)

**Integration test structure** (using fastify.inject):

```typescript
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("Magic-Link Authentication (AUTH-01–04)", () => {
  it("POST /api/auth/sign-in/magic-link with allowlisted email sends mail", async () => {
    const app = await buildApp();
    
    // Arrange: seed INITIAL_ADMIN_EMAIL user
    // (admin-seed.ts runs at boot, creates User with that email)
    
    // Act: request magic link for that email
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      payload: { email: process.env.INITIAL_ADMIN_EMAIL },
    });
    
    // Assert: response is 200, mail was sent
    expect(res.statusCode).toBe(200);
    // Assert mail body contains a token/URL (via Mailpit or spy pattern)
    
    await app.close();
  });

  it("POST /api/auth/sign-in/magic-link with non-allowlisted email returns identical response (D-01 neutral)", async () => {
    const app = await buildApp();
    
    const res1 = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      payload: { email: process.env.INITIAL_ADMIN_EMAIL },
    });
    
    const res2 = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      payload: { email: "never-allowlisted@example.com" },
    });
    
    // Assert: both responses are byte-identical (same status, body, headers)
    expect(res1.statusCode).toBe(res2.statusCode);
    expect(res1.body).toBe(res2.body);
    
    await app.close();
  });

  it("GET /api/auth/magic-link/verify?token=VALID_TOKEN signs user in (creates session)", async () => {
    const app = await buildApp();
    
    // Arrange: send a magic link request, extract token from mail
    // (would need Mailpit wiring or a sendMagicLink spy for this)
    
    // Act: visit the verify URL with the token
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/magic-link/verify?token=...",
    });
    
    // Assert: redirects with Set-Cookie header (httpOnly session cookie)
    expect(res.statusCode).toBe(302); // or 303
    expect(res.headers["set-cookie"]).toBeDefined();
    
    await app.close();
  });
});
```

**Requirements:**
- Tests must actually send magic links via SMTP (either real Mailpit or a spy)
- AUTH-01 tests that `sendMagicLink` is called for allowlisted emails
- AUTH-02 tests that a valid token creates a session (cookie set)
- AUTH-03 tests that session survives repeated `getSession()` calls
- AUTH-04 tests that logout clears the session
- D-01 tests that allowlisted vs. non-allowlisted emails return identical responses (canary)

---

### Frontend (Vue/Pinia)

#### `apps/web/src/stores/authSession.ts` (store, transform/state)

**Analog:** No direct Phase 1 analog. Use standard Pinia pattern from RESEARCH.md.

**Pinia store structure** (Composition API setup function pattern):

```typescript
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getSession, logout } from "../api.js";

export type SessionUser = {
  id: string;
  email: string;
};

export const useAuthSession = defineStore("authSession", () => {
  const user = ref<SessionUser | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value !== null);

  async function fetchSession(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const session = await getSession();
      user.value = session.user ?? null;
    } catch (err) {
      user.value = null;
      error.value = err instanceof Error ? err.message : "Unknown error";
    } finally {
      loading.value = false;
    }
  }

  async function signOut(): Promise<void> {
    try {
      await logout();
      user.value = null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to sign out";
    }
  }

  return { user, isAuthenticated, loading, error, fetchSession, signOut };
});
```

**Key constraints:**
- Call `fetchSession()` on app boot (in `main.ts` or router guard) to rehydrate from server
- httpOnly cookies auto-attach to all requests, so client doesn't need to store/send tokens
- Logout clears local `user` state after successful server-side session deletion

---

#### `apps/web/src/stores/theme.ts` (store, transform/state)

**Analog:** No direct Phase 1 analog. Standard localStorage + Pinia pattern.

**Theme store structure**:

```typescript
import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type Theme = "light" | "dark";

export const useTheme = defineStore("theme", () => {
  // Read from localStorage or default to "light"
  const stored = localStorage.getItem("kurzly-theme") as Theme | null;
  const theme = ref<Theme>(stored === "dark" ? "dark" : "light");

  // Apply theme to DOM immediately (pre-paint, no FOUC)
  applyTheme(theme.value);

  function toggle(): void {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  // Watch for changes: update DOM + localStorage
  watch(theme, (newTheme) => {
    applyTheme(newTheme);
    localStorage.setItem("kurzly-theme", newTheme);
  });

  return { theme, toggle };
});

function applyTheme(t: Theme): void {
  document.body.dataset.theme = t === "dark" ? "dark" : "";
}
```

**Key constraints:**
- Initialize theme BEFORE Vue mounts (in `main.ts`, lines 1–3) to avoid FOUC (Pattern 3, RESEARCH.md lines 316–328)
- `data-theme` attribute on `<body>` drives CSS custom properties (UI-SPEC locked)

---

#### `apps/web/src/router/index.ts` (hook, transform)

**Analog:** No direct Phase 1 analog. Standard Vue Router 4 + Pinia pattern.

**Router setup with auth guard**:

```typescript
import { createRouter, createWebHistory } from "vue-router";
import { useAuthSession } from "../stores/authSession.js";
import LoginView from "../views/LoginView.vue";
import AuthErrorView from "../views/AuthErrorView.vue";
import DashboardView from "../views/DashboardView.vue";
import ComingSoonView from "../views/ComingSoonView.vue";

export const routes = [
  // Public routes (no auth required)
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

  // Protected routes (auth required)
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
    meta: { requiresAuth: true },
  },
  // ... other nav items: qr-codes, analytics, domains, team
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guard: check auth before entering protected routes
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthSession();

  // Fetch session on first load (if not already cached)
  if (!authStore.user && to.meta.requiresAuth) {
    await authStore.fetchSession();
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    // Redirect to login, not auth error (user just isn't logged in yet)
    next({ name: "login" });
  } else {
    next();
  }
});

export default router;
```

**Key patterns:**
- `beforeEach` guard checks `requiresAuth` metadata
- Calls `fetchSession()` to rehydrate from server (via `GET /api/auth/get-session` → better-auth)
- UX convenience only — API independently checks session on every protected request

---

#### `apps/web/src/views/LoginView.vue` (component, request-response)

**Analog:** `apps/web/src/App.vue` (Vue 3 `<script setup>` pattern, lines 1–38)

**Two-state login component** (Idle → Sent):

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const email = ref("");
const state = ref<"idle" | "sent">("idle");
const error = ref<string | null>(null);
const loading = ref(false);

async function sendMagicLink(): Promise<void> {
  error.value = null;
  loading.value = true;
  try {
    const response = await fetch("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value }),
    });
    if (!response.ok) {
      error.value = "Der Magic Link konnte nicht gesendet werden. Bitte versuche es erneut.";
      return;
    }
    state.value = "sent";
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Netzwerkfehler beim Senden.";
  } finally {
    loading.value = false;
  }
}

function resetEmail(): void {
  email.value = "";
  state.value = "idle";
}
</script>

<template>
  <!-- Locked layout per UI-SPEC (360px card, centered, 30×30 logo) -->
  <div class="login-wrapper">
    <!-- Brand row -->
    <div class="brand-row">
      <div class="logo-mark">K</div>
      <h1 class="brand-name">Kurzly</h1>
    </div>

    <div class="card">
      <!-- Idle state -->
      <template v-if="state === 'idle'">
        <h2 class="card-title">Anmelden</h2>
        <p class="card-body">
          Wir senden dir einen Magic Link an deine E-Mail — kein Passwort nötig.
        </p>
        <input
          v-model="email"
          type="email"
          placeholder="du@firma.de"
          class="auth-input"
        />
        <button
          :disabled="loading"
          class="primary-button"
          @click="sendMagicLink"
        >
          Magic Link senden
        </button>
        <p v-if="error" class="error-inline">{{ error }}</p>
      </template>

      <!-- Sent state -->
      <template v-else>
        <div class="sent-state">
          <div class="sent-icon">✉</div>
          <h2 class="card-title">Link gesendet</h2>
          <p class="card-body">
            Prüfe <code>{{ email }}</code> — der Link ist 15 Minuten gültig.
          </p>
          <a href="#" class="back-link" @click.prevent="resetEmail">
            ← andere E-Mail verwenden
          </a>
        </div>
      </template>
    </div>

    <p class="footer-text">Auth via better-auth · self-hosted</p>
  </div>
</template>

<style scoped>
/* Follows UI-SPEC LOCKED tokens: 360px card width, theme variables, typography */
.login-wrapper {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-family: "Geist", system-ui, sans-serif;
  color: var(--text);
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.logo-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #1b1b18;
}

.brand-name {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}

.card {
  width: 360px;
  max-width: 100%;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 26px 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.card-body {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

.auth-input {
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg);
  color: var(--text);
  font-size: 13.5px;
  font-family: "Geist Mono", monospace;
  outline: none;
}

.auth-input:focus {
  border-color: var(--text);
}

.primary-button {
  padding: 11px 0;
  background: var(--accent);
  color: #1b1b18;
  border: none;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.primary-button:hover:not(:disabled) {
  opacity: 0.85;
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-inline {
  font-size: 11.5px;
  color: #e5484d;
  margin: 0;
  margin-top: -6px;
}

.sent-state {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  text-align: center;
  padding: 8px 0;
}

.sent-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #1b1b18;
}

.back-link {
  font-size: 12px;
  color: var(--mut);
  text-decoration: none;
  cursor: pointer;
  margin-top: 2px;
}

.back-link:hover {
  color: var(--text);
}

.footer-text {
  font-size: 11px;
  color: var(--mut);
  text-align: center;
  margin-top: 18px;
}

code {
  font-family: "Geist Mono", monospace;
  color: var(--text);
}
</style>
```

**Key constraints:**
- Two states: `idle` (form) → `sent` (confirmation message)
- D-01 neutral response means UI sees the same "sent" state regardless of allowlist status
- Sent state shows email address in Geist Mono per UI-SPEC
- 44×44px sent icon circle with `✉` character

---

#### `apps/web/src/views/AuthErrorView.vue` (component, request-response)

**Analog:** `apps/web/src/App.vue` (component structure, styling pattern)

**Error page for expired/invalid/used links** (D-05):

```vue
<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();

function requestNewLink(): void {
  router.push({ name: "login" });
}
</script>

<template>
  <!-- Same root layout as LoginView -->
  <div class="error-wrapper">
    <div class="brand-row">
      <div class="logo-mark">K</div>
      <h1 class="brand-name">Kurzly</h1>
    </div>

    <div class="card">
      <div class="error-content">
        <div class="error-icon">⚠</div>
        <h2 class="card-title">Dieser Link ist ungültig oder abgelaufen</h2>
        <p class="card-body">
          Magic Links sind nur 15 Minuten gültig und können nur einmal
          verwendet werden. Fordere einfach einen neuen an.
        </p>
        <button class="primary-button" @click="requestNewLink">
          Neuen Link anfordern
        </button>
      </div>
    </div>

    <p class="footer-text">Auth via better-auth · self-hosted</p>
  </div>
</template>

<style scoped>
/* Identical root/brand/card/footer styling as LoginView — reuse or extract to shared CSS */
.error-wrapper {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.brand-row,
.logo-mark,
.brand-name,
.card,
.primary-button,
.footer-text {
  /* Reuse LoginView styles */
}

.error-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  text-align: center;
}

.error-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--chip);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.card-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0;
}
</style>
```

**Key constraints:**
- Generic error message (no differentiation between expired/used/invalid per D-05)
- 52×52px icon tile with `⚠` character
- Button returns to login (no link-embed, no enumeration leak)

---

#### `apps/web/src/views/DashboardView.vue` (component, request-response)

**Analog:** `apps/web/src/App.vue` (component structure)

**Dashboard landing** (D-03, warm welcome):

```vue
<script setup lang="ts">
// No API calls yet — Phase 2 is scaffold only
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>Übersicht</h1>
    </div>
    <p>
      Willkommen bei Kurzly. Deine Übersicht füllt sich, sobald du Links,
      Domains und QR-Codes anlegst.
    </p>
  </div>
</template>

<style scoped>
.screen-container {
  max-width: 1060px;
  margin: 0 auto;
  padding: 28px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.screen-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.screen-header h1 {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

p {
  font-size: 13.5px;
  color: var(--text);
}
</style>
```

**Rationale:** Warm, encouraging message (not dashed empty-state box). Real content comes in later phases.

---

#### `apps/web/src/views/ComingSoonView.vue` (component, request-response)

**Analog:** `apps/web/src/App.vue` (component structure)

**Reusable placeholder** for all not-yet-built feature screens:

```vue
<script setup lang="ts">
import { useRoute } from "vue-router";

const route = useRoute();

// Extract feature name from route meta or compute from route name
const featureName = (route.meta?.label as string) || "Feature";
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>{{ featureName }}</h1>
    </div>

    <div class="coming-soon-card">
      <h3 class="card-heading">{{ featureName }} — bald verfügbar</h3>
      <p class="card-body">
        Dieser Bereich ist noch nicht freigeschaltet. Er kommt in einer der
        nächsten Phasen.
      </p>
    </div>
  </div>
</template>

<style scoped>
.screen-container {
  max-width: 1060px;
  margin: 0 auto;
  padding: 28px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.screen-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.screen-header h1 {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

.coming-soon-card {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  background: var(--panel);
  text-align: center;
}

.card-heading {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 4px 0;
}

.card-body {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}
</style>
```

**Reuse:** Route to this component for `/links`, `/qr-codes`, `/analytics`, `/domains`, `/team` (all pass route meta with `label: "Links"` etc.)

---

#### `apps/web/src/layouts/AppShell.vue` (layout, request-response)

**Analog:** `apps/web/src/App.vue` (component structure, styling pattern)

**Persistent sidebar + content, per UI-SPEC LOCKED layout** (212px sidebar, scrollable content):

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthSession } from "../stores/authSession.js";
import { useTheme } from "../stores/theme.js";

const router = useRouter();
const authStore = useAuthSession();
const themeStore = useTheme();

const navItems = [
  { label: "Dashboard", to: { name: "dashboard" } },
  { label: "Links", to: { name: "links" } },
  { label: "QR-Codes", to: { name: "qr-codes" } },
  { label: "Analytics", to: { name: "analytics" } },
  { label: "Domains", to: { name: "domains" } },
  { label: "Team", to: { name: "team" } },
];

const isActive = (routeName: string): boolean => {
  return router.currentRoute.value.name === routeName;
};

async function handleLogout(): Promise<void> {
  await authStore.signOut();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="app-root">
    <!-- Sidebar -->
    <aside class="sidebar">
      <!-- Logo row -->
      <div class="logo-row">
        <div class="logo-mark">K</div>
        <span class="brand-name">Kurzly</span>
      </div>

      <!-- Nav list -->
      <nav class="nav-list">
        <RouterLink
          v-for="item in navItems"
          :key="item.label"
          :to="item.to"
          :class="['nav-item', { active: isActive(item.to.name as string) }]"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <!-- Footer: theme toggle, version, user, logout -->
      <div class="sidebar-footer">
        <!-- Theme toggle -->
        <div class="theme-toggle" @click="themeStore.toggle">
          <span class="label">{{ themeStore.theme === "dark" ? "Light Mode" : "Dark Mode" }}</span>
          <div class="switch-track" :class="{ active: themeStore.theme === 'dark' }">
            <div class="switch-knob"></div>
          </div>
        </div>

        <!-- Version text -->
        <p class="version-text">v0.1.0 · self-hosted</p>

        <!-- User row -->
        <div class="user-row">
          <div class="avatar">
            {{ authStore.user?.email.substring(0, 1).toUpperCase() ?? "?" }}
          </div>
          <div class="user-info">
            <div class="user-name">{{ authStore.user?.email || "User" }}</div>
            <div class="user-role">member</div>
          </div>
          <button
            class="logout-btn"
            title="Abmelden"
            @click="handleLogout"
          >
            ⏻
          </button>
        </div>
      </div>
    </aside>

    <!-- Content area -->
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-root {
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
  list-style: none;
  margin: 0;
}

.nav-item {
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13.5px;
  font-weight: 400;
  color: var(--mut);
  cursor: pointer;
  text-decoration: none;
  display: block;
  transition: all 0.15s ease;
}

.nav-item:hover {
  background: var(--hover);
  color: var(--text);
}

.nav-item.active {
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
  transition: background 0.15s ease;
}

.theme-toggle:hover {
  background: var(--hover);
}

.label {
  flex: 1;
}

.switch-track {
  width: 30px;
  height: 16px;
  border-radius: 999px;
  background: var(--border);
  position: relative;
  transition: background 0.15s ease;
}

.switch-track.active {
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

.switch-track.active .switch-knob {
  left: 16px;
}

.version-text {
  font-size: 11px;
  color: var(--mut);
  padding: 0 4px;
  margin: 0;
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
  border-radius: 50%;
  background: var(--chip);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--mut);
  flex-shrink: 0;
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
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
  padding: 3px;
  background: none;
  border: none;
  color: var(--mut);
  cursor: pointer;
  font-size: 16px;
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
```

**Key constraints:**
- 212px fixed sidebar (D-03)
- All nav items visible (6 total: Dashboard + 5 features)
- Active nav item uses `--chip` background + bold
- Footer: theme toggle (30×16px switch), version "v0.1.0 · self-hosted", user row (26×26 avatar + name/role + logout icon)
- Content area: flex:1, scrollable, min-width:0 (prevents flex-shrink issues)
- Logout button is icon-only (`⏻`) with title tooltip

---

#### `apps/web/src/App.vue` (component, request-response)

**Analog:** `apps/web/src/App.vue` (Phase 1, replaced)

**Root component** (mounts router-view inside AppShell for authenticated routes, direct router-view for public):

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useTheme } from "./stores/theme.js";
import { useAuthSession } from "./stores/authSession.js";
import AppShell from "./layouts/AppShell.vue";
import LoginView from "./views/LoginView.vue";
import AuthErrorView from "./views/AuthErrorView.vue";

const router = useRouter();
const authStore = useAuthSession();
const themeStore = useTheme();

// Fetch session on app init
onMounted(async () => {
  // Theme store auto-initializes from localStorage (pre-paint)
  // Auth store fetches session on first protected-route access via beforeEach
  // But we can optionally pre-fetch here for UX (avoid flashing login → dashboard)
  await authStore.fetchSession();
});

// Determine which layout to show
const isPublicRoute = computed(() => {
  const name = router.currentRoute.value.name;
  return name === "login" || name === "auth-error";
});
</script>

<template>
  <!-- Theme attribute applied by theme store -->
  <div id="app">
    <!-- Conditional layout: AppShell for protected routes, full-screen for public auth routes -->
    <AppShell v-if="authStore.isAuthenticated && !isPublicRoute" />
    <div v-else-if="isPublicRoute" class="public-view">
      <RouterView />
    </div>
    <div v-else class="loading">
      <!-- Fallback while session is being fetched -->
      Loading...
    </div>
  </div>
</template>

<style scoped>
#app {
  width: 100%;
  height: 100vh;
}

.public-view {
  width: 100%;
  height: 100%;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
}
</style>
```

**Simplifications for Phase 2:**
- Root just handles layout switching (AppShell vs. public)
- Router+guards handle navigation gating
- Theme store pre-applies theme before mount (no FOUC)

---

#### `packages/shared/src/index.ts` (model, transform)

**Analog:** `packages/shared/src/index.ts` (Phase 1, extended)

**Extend with Phase 2 DTOs**:

```typescript
/**
 * Skeleton DTOs shared between apps/api and apps/web.
 * Real domain DTOs (Link, Domain, QRCode, etc.) added in later phases.
 */

// Phase 1 (unchanged)
export type HealthStatus = {
  status: "ok";
};

export type CanaryResult = {
  token: string;
  total: number;
};

// Phase 2 (NEW)

export const ROLE_HIERARCHY = { member: 0, admin: 1, owner: 2 } as const;
export type Role = keyof typeof ROLE_HIERARCHY;

export type SessionUser = {
  id: string;
  email: string;
  // Per-domain role is determined by DomainMembership, not stored on User itself
};

export type DomainMembership = {
  userId: string;
  domainId: string;
  role: Role;
};

export type Domain = {
  id: string;
  createdAt: string;
  // Full domain data (name, slug, verified DNS, TLS cert) added Phase 3
};

export type AuthSession = {
  user: SessionUser | null;
};
```

**Key constraints:**
- `SessionUser` is minimal (no per-domain role embedded, only `DomainMembership` knows that)
- `Role` enum stays in sync between backend auth.ts and frontend components
- These DTOs are used by API client functions in `apps/web/src/api.ts` to type responses

---

## Shared Patterns

### Authentication & Session

**Source:** `apps/api/src/lib/auth.ts` (better-auth instance)
**Apply to:** All protected API routes (Phase 3+), App Shell logout action, router guards
**Pattern:**
```typescript
// Server-side: auth.handler() processes requests, sets httpOnly cookies automatically
const response = await auth.handler(fetchRequest);
reply.status(response.status);
response.headers.forEach((value, key) => reply.header(key, value));

// Client-side: cookies auto-attach to fetch() requests (same-origin)
// Session rehydration via GET /api/auth/get-session called by router beforeEach or app boot
```

### Authorization (Domain-Scoped)

**Source:** `apps/api/src/lib/authorization.ts` (requireDomainAccess, scopedDomainIds)
**Apply to:** All routes reading/writing domain-scoped data (Phase 3+, Links/QR/Analytics/Domains/Team)
**Pattern:**
```typescript
// Every route: check permission before querying
await requireDomainAccess(prisma, userId, domainId, "admin");
// or: get all accessible domains for the user
const domainIds = await scopedDomainIds(prisma, userId);
```

### Theme Persistence (Pre-Paint)

**Source:** `apps/web/src/main.ts` + `apps/web/src/stores/theme.ts`
**Apply to:** All frontend apps that use theme toggle
**Pattern:**
```typescript
// main.ts (lines 1–3, BEFORE createApp/mount):
const stored = localStorage.getItem("kurzly-theme");
const theme = stored === "dark" ? "dark" : "light";
document.body.dataset.theme = theme === "dark" ? "dark" : "";

// Then Pinia store syncs DOM changes + localStorage on toggle
```

### Test Isolation (Real Postgres)

**Source:** `apps/api/test/globalSetup.ts` + `apps/api/test/setupFileEach.ts`
**Apply to:** All unit/integration tests touching the database
**Pattern:**
```typescript
// globalSetup starts ONE shared Postgres 18-alpine container per test run
// setupFileEach wraps each test in BEGIN/ROLLBACK on a max:1 connection pool

// In test file:
import { prisma } from "./setupFileEach.js";
await prisma.someModel.create({ data: {...} }); // auto-rolled-back after test
```

---

## No Analog Found

Files with no close match (planner should use RESEARCH.md patterns or standard Vue/Fastify practices):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/web/src/stores/authSession.ts` | store | transform/state | No Pinia store existed in Phase 1; use standard Pinia Composition API pattern |
| `apps/web/src/stores/theme.ts` | store | transform/state | No Pinia store existed in Phase 1; use standard localStorage + Pinia pattern |
| `apps/web/src/router/index.ts` | hook | transform | No Vue Router config existed in Phase 1; use standard Vue Router v4 + beforeEach guard pattern |

---

## Metadata

**Analog search scope:** `apps/api/src/`, `apps/api/test/`, `apps/web/src/`, `packages/shared/src/`
**Files scanned:** 30+ (routes, plugins, tests, components, config)
**Pattern extraction date:** 2026-07-11

**Coverage summary:**
- **Exact matches (same role + data flow):** 11 files (app.ts, env.ts, db.ts, server.ts, routes, plugins, schema, tests)
- **Role matches (same role, different data flow):** 5 files (auth service, authorization, component views)
- **No analog (new pattern):** 5 files (Pinia stores, Vue Router, no Phase 1 equivalent)

**Key cross-cutting patterns locked for Phase 2:**
1. Fastify route registration order: helmet → rate-limit → auth → canary → health → redirect → static → 404
2. Real-Postgres TDD harness with per-test rollback (no mock Prisma)
3. Fail-fast ENV validation with Zod (extend envSchema, no new pattern)
4. Single Prisma client instance from `apps/api/src/generated/prisma` (shared by app + better-auth)
5. better-auth instance with magicLink() only, disableSignUp: true, neutral-response in sendMagicLink callback
6. Vue 3 `<script setup>` Composition API throughout (no Options API)
7. Pinia for authSession + theme stores with localStorage persistence
8. UI-SPEC LOCKED design tokens (CSS custom properties, 212px sidebar, 360px auth card, theme data attribute)

