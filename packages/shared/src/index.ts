/**
 * Skeleton DTOs shared between apps/api and apps/web.
 * Real domain DTOs (Link, Domain, QRCode, etc.) are added in later phases.
 */

export type HealthStatus = {
  status: "ok";
};

export type CanaryResult = {
  token: string;
  total: number;
};

// Phase 2 (magic-link auth + domain authorization core, D-02/D-02b)

/**
 * Domain-scoped role hierarchy (owner > admin > member). Higher numeric
 * rank implies every permission of the ranks below it — this const is the
 * single source of truth `apps/api/src/lib/authorization.ts`'s
 * `requireDomainAccess` compares against (kept in sync there under the
 * name `ROLE_RANK` — same values, do not let the two drift).
 */
export const ROLE_HIERARCHY = { member: 0, admin: 1, owner: 2 } as const;
export type Role = keyof typeof ROLE_HIERARCHY;

export type SessionUser = {
  id: string;
  email: string;
};

export type DomainMembership = {
  userId: string;
  domainId: string;
  role: Role;
};

export type Domain = {
  id: string;
  createdAt: string;
  // Minimal schema — full lifecycle (name, DNS verification, TLS) added
  // in Phase 3.
};

export type AuthSession = {
  user: SessionUser | null;
};
