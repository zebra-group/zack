/**
 * Shared display-formatting helpers (IN-03 fix, 04-REVIEW.md) — extracted
 * from an identical `formatDate()` that was previously copy-pasted
 * verbatim into both LinksView.vue and LinkDetailView.vue.
 */

/** Formats an ISO 8601 date string as `dd.mm.yyyy` (the app's display convention). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}
