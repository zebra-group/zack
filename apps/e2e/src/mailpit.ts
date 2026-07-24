/**
 * Mailpit REST client (INFRA-02, T-11-07) — a thin fetch wrapper reading
 * Mailpit's REST API on `MAILPIT_URL` (default `http://localhost:8025`,
 * the compose-published port, see `docker-compose.dev.yml`).
 *
 * `findMagicLinkUrl` is STRICTLY recipient-scoped: it retrieves via
 * `GET /api/v1/search?query=to:<recipient>` (never the bare
 * `GET /api/v1/messages` list, which returns every message currently in
 * the mailbox with no recipient filter — RESEARCH Pitfall 1, the #1
 * flakiness/cross-worker-email-theft source flagged by CONTEXT.md) and
 * hard-asserts the retrieved message's `To` address equals the requested
 * recipient before returning a link — a worker can never consume another
 * worker's magic-link email even if multiple recipients' emails are
 * in-flight at once.
 */

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

interface MailpitSearchMessage {
  ID: string;
  To: Array<{ Address: string; Name: string }>;
}

interface MailpitSearchResponse {
  total: number;
  count: number;
  messages: MailpitSearchMessage[];
}

interface MailpitMessage {
  ID: string;
  To: Array<{ Address: string; Name: string }>;
  Text: string;
}

/**
 * Confirmed empirically against `better-auth@1.6.23`'s installed
 * `magic-link` plugin source
 * (`node_modules/better-auth/dist/plugins/magic-link/index.mjs`): the
 * verify URL is built as
 * `new URL(\`${pathname}${basePath}/magic-link/verify\`, realBaseURL.origin)`
 * where `basePath` defaults to `/api/auth` and `realBaseURL` is
 * `BASE_URL` (`http://localhost:3000` in `docker-compose.e2e.yml`) — i.e.
 * `http://localhost:3000/api/auth/magic-link/verify?token=...&callbackURL=...`.
 * This regex intentionally matches the path prefix only (not the full
 * query string), so it is resilient to whichever query params
 * (`callbackURL`, `newUserCallbackURL`, `errorCallbackURL`) happen to be
 * present.
 */
const MAGIC_LINK_URL_PATTERN = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/;

/**
 * Bounded poll of Mailpit's recipient-scoped search endpoint. When a
 * matching message is found, fetches its full body, hard-asserts the `To`
 * address equals `recipient` (never trusts the search filter alone — see
 * header comment), and extracts the magic-link URL from the plain-text
 * `Text` MIME part (never `HTML`, which entity-escapes `&` in query
 * strings).
 *
 * Throws a clear timeout error if no matching message with a valid
 * magic-link URL is found within `timeoutMs`.
 */
export async function findMagicLinkUrl(recipient: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const searchRes = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
    );
    const searchData = (await searchRes.json()) as MailpitSearchResponse;

    if (searchData.count > 0) {
      const firstMessage = searchData.messages[0];
      if (firstMessage) {
        const messageRes = await fetch(`${MAILPIT_URL}/api/v1/message/${firstMessage.ID}`);
        const message = (await messageRes.json()) as MailpitMessage;

        // Hard assertion: never trust the search filter alone — a worker
        // must never consume another worker's magic-link email (T-11-07).
        const toAddress = message.To[0]?.Address;
        if (toAddress !== recipient) {
          throw new Error(
            `Mailpit search for "to:${recipient}" returned a message actually addressed ` +
              `to "${toAddress ?? "(none)"}" — refusing to use it (cross-worker email theft guard).`,
          );
        }

        const match = MAGIC_LINK_URL_PATTERN.exec(message.Text);
        if (match) {
          return match[0];
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No magic-link email found for ${recipient} within ${timeoutMs}ms`);
}

/** Empties Mailpit's inbox entirely — used once in `global-setup.ts` so
 * every run starts from a clean mailbox. */
export async function clearInbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}
