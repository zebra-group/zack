/**
 * Pure client-side mirror of the server's `applyUtmParams`
 * (apps/api/src/lib/redirectEngine.ts) — powers ONLY the Surface A live
 * preview in `LinkFormModal.vue` (META-01, UI-08-10, 08-UI-SPEC.md).
 * Lives in its own `.ts` module rather than inside the SFC because the
 * generic `*.vue` module shim (`vite-env.d.ts`) only declares a `default`
 * export, so a named export from inside a single-file component's
 * `<script>` block would not type-check under plain `tsc --noEmit` (no
 * vue-tsc in this repo, same reasoning as `api.ts`'s `mapLinkFormError`).
 *
 * The preview must never promise a destination the eventual redirect
 * would not actually deliver, so the PRIMARY path below mirrors the
 * server's algorithm exactly: same guard-first no-op (no `new URL()`
 * round-trip when nothing is set — that would silently append a trailing
 * slash to an origin-only URL and rewrite encoding), same
 * delete-then-set-in-canonical-order mutation, same
 * WHATWG URL/URLSearchParams-only percent-encoding.
 *
 * The one deliberate addition over the server function is the FALLBACK
 * path: the server only ever sees a `targetUrl` already validated by
 * `validateTargetUrl` at write time, but this preview recomputes on every
 * keystroke of a form the user is actively typing into — including states
 * like "htt" or "example" that will never be submitted, where
 * `new URL(x)` just throws. The fallback keeps the locked prototype's
 * plain string-concat shape (Prototyp Z.881-887) so the preview degrades
 * to something readable instead of throwing mid-type, while still routing
 * every value through `URLSearchParams` so both paths agree on encoding.
 */

const UNFILLED_TARGET_PLACEHOLDER = "https://example.com/…";

export type UtmValues = {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};

/** A UTM value counts as "set" only when it is a non-empty, non-whitespace-only string. */
function isSetUtmValue(value: string): boolean {
  return value.trim().length > 0;
}

/** `[key, value]` pairs for the non-empty fields, in the LOCKED source/medium/campaign order. */
function setParamPairs(utm: UtmValues): [string, string][] {
  const pairs: [string, string][] = [];
  if (isSetUtmValue(utm.utmSource)) pairs.push(["utm_source", utm.utmSource]);
  if (isSetUtmValue(utm.utmMedium)) pairs.push(["utm_medium", utm.utmMedium]);
  if (isSetUtmValue(utm.utmCampaign)) pairs.push(["utm_campaign", utm.utmCampaign]);
  return pairs;
}

/**
 * Builds the Surface A live-preview string for a given typed target URL +
 * the three UTM inputs. Never throws — a target that does not parse as a
 * URL (the user is still typing) degrades to the locked fallback shape
 * rather than raising.
 */
export function buildUtmPreview(targetUrl: string, utm: UtmValues): string {
  const pairs = setParamPairs(utm);

  if (pairs.length === 0) {
    // Guard-first, exactly like `applyUtmParams`: no `new URL()`
    // round-trip when nothing is set, so the preview never normalizes
    // what the user actually typed (e.g. adds a trailing slash).
    return targetUrl.trim().length === 0 ? UNFILLED_TARGET_PLACEHOLDER : targetUrl;
  }

  try {
    const target = new URL(targetUrl);
    // Only the keys the builder actually sets are delete-then-set (WR-01),
    // mirroring the server's narrowed applyUtmParams exactly: a key whose
    // builder field is empty is absent from `pairs` and left untouched, so
    // a value the owner manually embedded in the target is preserved. The
    // delete-before-set of a present key re-appends it at the end in the
    // locked source/medium/campaign order rather than leaving it pinned.
    for (const [key, value] of pairs) {
      target.searchParams.delete(key);
      target.searchParams.set(key, value);
    }
    return target.toString();
  } catch {
    // Fallback: `targetUrl` does not parse as an absolute URL — keep the
    // locked prototype shape instead of throwing (Prototyp Z.881-887).
    // `URLSearchParams` still does the encoding, so this path agrees with
    // the primary path above on how a space/ampersand is represented.
    const base = targetUrl.trim().length === 0 ? UNFILLED_TARGET_PLACEHOLDER : targetUrl;
    const sep = base.includes("?") ? "&" : "?";
    return base + sep + new URLSearchParams(pairs).toString();
  }
}
