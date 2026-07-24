/**
 * Playwright global teardown (INFRA-02/03) — runs once after the whole
 * suite completes. `globalSetup`/`globalTeardown` are separate Node
 * process invocations (Playwright does not keep the setup process alive),
 * so there is no single in-memory Prisma client instance to hand over —
 * this creates its own short-lived client purely to close its connection
 * pool cleanly rather than relying on process exit to reclaim it.
 */
import { createE2ePrisma } from "./src/db.js";

export default async function globalTeardown(): Promise<void> {
  const prisma = createE2ePrisma();
  await prisma.$disconnect();
}
