/**
 * Playwright global setup (INFRA-02/03) — runs once before any spec/project:
 * clears Mailpit's inbox and seeds the least-privilege baseline (Domain,
 * admin User, Member User + DomainMembership) directly via the reused
 * Prisma client, so every spec file starts from the same known state.
 */
import { createE2ePrisma, seedBaseline } from "./src/db.js";
import { clearInbox } from "./src/mailpit.js";

export default async function globalSetup(): Promise<void> {
  const prisma = createE2ePrisma();
  try {
    await clearInbox();
    await seedBaseline(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
