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

// Phase 3 (domains & multi-domain TLS routing, D-01..04)

/**
 * Full domain lifecycle DTO — replaces the Phase-2 placeholder `Domain`
 * type above once every field crosses the JSON boundary. Date fields are
 * `string | null` (ISO 8601), not `Date`, since DTOs only ever travel as
 * JSON (apps/api's `toDomainDto()` mapping, apps/web's `api.ts` client).
 */
export type DomainDTO = {
  id: string;
  hostname: string;
  type: "subdomain" | "apex";
  status: "pending" | "active" | "failed";
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  createdAt: string;
};

export type AuthSession = {
  user: SessionUser | null;
};
