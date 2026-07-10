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
