/**
 * Security-header baseline (D-07, WR-04, T-02-06) — mirrors `plugins/cors.ts`'s
 * registration-function shape.
 *
 * The default `@fastify/helmet` CSP (`defaultSrc: ["'self'"]`-style strict)
 * would block the Geist/Geist Mono Google Fonts `<link>` the App Shell needs
 * (UI-03) and the inline `style` attributes the hand-written Vue SFCs use —
 * so `styleSrc`/`fontSrc` explicitly allowlist `fonts.googleapis.com` /
 * `fonts.gstatic.com` (RESEARCH Pitfall 4). `imgSrc` allows `data:` ahead of
 * time for the QR data-URI previews later phases render.
 */
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

export async function registerHelmet(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Inline styles are used by the hand-written SFCs (no CSS
        // framework, per CLAUDE.md's Design System constraint).
        styleSrc: ["'self'", "fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "fonts.gstatic.com"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  });
}
