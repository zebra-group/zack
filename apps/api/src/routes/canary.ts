/**
 * PersistenceCanary read/write route (D-08, key_links) — the walking
 * skeleton's one real DB WRITE and READ against real Postgres. Also
 * doubles as the operator-facing canary used to verify the named Postgres
 * volume survives a `docker-compose down`/`up` cycle without `-v`.
 *
 * `canaryRoute(prisma)` is a Fastify-plugin FACTORY (not a plugin itself)
 * so the caller supplies the Prisma client to use: production wires the
 * `db.ts` singleton (app.ts), while integration tests wire the SAME
 * transaction-wrapped client `test/setupFileEach.ts` uses, so GET reflects
 * writes made earlier in the same rolled-back test transaction.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { CanaryResult } from "@zack/shared";
import type { PrismaClient } from "../generated/prisma/client.js";

export function canaryRoute(prisma: PrismaClient) {
  return async function registerCanaryRoute(app: FastifyInstance): Promise<void> {
    app.post("/canary", async (): Promise<CanaryResult> => {
      const token = randomUUID();
      await prisma.persistenceCanary.create({ data: { token } });
      const total = await prisma.persistenceCanary.count();
      return { token, total };
    });

    app.get("/canary", async (): Promise<{ total: number; latest: string | null }> => {
      const total = await prisma.persistenceCanary.count();
      const latestRow = await prisma.persistenceCanary.findFirst({
        orderBy: { createdAt: "desc" },
      });
      return { total, latest: latestRow?.token ?? null };
    });
  };
}
