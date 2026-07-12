/**
 * Link-bound, self-invalidating unlock cookie (D-07/D-08, RESEARCH
 * Pattern 4, T-05-COOKIE-FORGE) — issued on a successful
 * `POST /:slug/verify` (route wired in 05-06), checked on every
 * `GET /:slug` for a `protected`-state link (see `lib/redirectEngine.ts`'s
 * `resolveLinkState`).
 *
 * The cookie's PAYLOAD is a digest of the link's CURRENT `passwordHash`,
 * never a bare boolean — this is the entire self-invalidation mechanism:
 * rotating or clearing a link's password changes `passwordHash`, which
 * changes `unlockPayload(passwordHash)`, which makes every previously
 * issued cookie for that link stop matching on the very next request. No
 * separate revocation bookkeeping is needed. A bare `unlocked=true` cookie
 * would NOT have this property (trivially copy-pasteable between
 * browsers/sessions, survives a password change) — see RESEARCH's
 * "Anti-Patterns to Avoid".
 *
 * Signed via `@fastify/cookie`'s `signed: true` (HMAC, tamper-evident),
 * `httpOnly` (no JS access), `sameSite: "strict"` (the verify form POST is
 * same-origin/top-level so Strict is safe and tighter than Lax), and
 * scoped to `path: /${slug}` (never sent to any other link's path). No
 * `maxAge`/`expires` is set — a browser-session cookie, matching D-08's
 * TTL.
 *
 * `Secure` is gated on `NODE_ENV === "production"`, not on
 * `request.protocol` — TLS termination is entirely operator-delegated
 * (Phase 3's Caddy/Traefik `ask` model); Fastify itself never terminates
 * TLS, so relying on `request.protocol` would require `TRUST_PROXY=true`
 * plus a correctly-forwarding reverse proxy just to set one cookie flag
 * correctly. `NODE_ENV` mirrors how the rest of this codebase already
 * gates environment-specific behavior (e.g. `app.ts`'s logger config).
 */
import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
// Side-effect import: pulls in @fastify/cookie's `declare module "fastify"`
// type augmentation (setCookie/cookies/unsignCookie) so FastifyReply/
// FastifyRequest below type-check against those methods, even though this
// module never registers the plugin itself (the route layer does that, in
// 05-06).
import "@fastify/cookie";
import type { Link } from "../generated/prisma/client.js";

const COOKIE_PREFIX = "kurzly_unlock_";

/** Stable per-link cookie name. */
export function cookieName(linkId: string): string {
  return `${COOKIE_PREFIX}${linkId}`;
}

/**
 * Short digest of the CURRENT `passwordHash` — deterministic for a given
 * hash, and changes whenever the underlying hash changes (new password,
 * cleared password). This IS the self-invalidation mechanism; see this
 * file's header comment.
 */
export function unlockPayload(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 32);
}

/** The subset of `Link` `hasValidUnlockCookie` needs. */
export type UnlockCheckLink = Pick<Link, "id" | "passwordHash">;

/** Issues the signed, session-lifetime, link-scoped unlock cookie on a successful password verify. */
export function issueUnlockCookie(
  reply: FastifyReply,
  linkId: string,
  slug: string,
  passwordHash: string,
): void {
  reply.setCookie(cookieName(linkId), unlockPayload(passwordHash), {
    signed: true,
    httpOnly: true,
    sameSite: "strict",
    path: `/${slug}`,
    secure: process.env.NODE_ENV === "production",
    // no maxAge/expires -> browser-session cookie (D-08).
  });
}

/** `false` when there's no passwordHash, no cookie, an invalid signature, or a stale (pre-rotation) payload. */
export function hasValidUnlockCookie(request: FastifyRequest, link: UnlockCheckLink): boolean {
  if (!link.passwordHash) return false;
  const raw = request.cookies[cookieName(link.id)];
  if (!raw) return false;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value === unlockPayload(link.passwordHash);
}
