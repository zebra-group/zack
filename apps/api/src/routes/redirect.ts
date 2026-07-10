/**
 * Redirect-handler STUB (D-01 single-image; T-01-11).
 *
 * This is intentionally a placeholder ONLY — there is no slug resolution,
 * target lookup, password-gate, expiry check, click tracking, or OG-tag
 * rendering here. Phase 5 ("Redirect Engine") replaces this route entirely
 * with the real 302-to-target / 410-Gone / password-gate / OG-preview
 * engine described in PROJECT.md's core value.
 *
 * Per T-01-11 (Information Disclosure, accepted risk): the stub returns a
 * generic 404 placeholder with no destination data and no resolution
 * logic, so there is nothing security-sensitive to leak ahead of Phase 5's
 * hardening pass.
 */
import type { FastifyInstance } from "fastify";

export async function redirectRoute(app: FastifyInstance): Promise<void> {
  app.get("/:slug", async (_request, reply) => {
    return reply.code(404).send({
      error: "Not Found",
      message: "Redirect engine not yet implemented (Phase 5).",
    });
  });
}
