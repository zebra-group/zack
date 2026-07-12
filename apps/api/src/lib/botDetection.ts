/**
 * Bot/crawler detection (D-04, RESEARCH Pattern 3, "Don't Hand-Roll") — a
 * single pure wrapper around `isbot`'s signature-list matching, with zero
 * Fastify/HTTP awareness of its own (the caller extracts the
 * `user-agent` header string and passes it in).
 *
 * Used by the redirect route (05-06) as a per-state check: a bot ALWAYS
 * gets the generic-OG 200 response, regardless of the link's
 * expired/protected/ok state (D-06, no exceptions) — see
 * `lib/redirectEngine.ts`'s `resolveLinkState` for the state classification
 * this composes with.
 *
 * Deliberately not hand-rolled: the set of crawler UAs changes constantly
 * (new social platforms, new AI crawlers); `isbot` ships regular signature
 * updates — a hand-maintained regex list would go stale immediately.
 */
import { isbot } from "isbot";

/** `undefined` (missing User-Agent header) is treated as "not a bot". */
export function isBotRequest(userAgent: string | undefined): boolean {
  return isbot(userAgent);
}
