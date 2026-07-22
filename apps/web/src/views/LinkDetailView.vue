<script setup lang="ts">
/**
 * Link detail screen (04-UI-SPEC.md Link-Detail, LINK-05/06/07, UI-06) —
 * route /links/:id. Loads the link via getLink(route.params.id); a 404
 * (ApiError, IDOR-guarded 404-for-both per 04-03) routes back to /links
 * with a toast rather than rendering a broken detail page.
 *
 * Phase 6 (06-UI-SPEC.md § Surface A, TRACK-01/TRACK-04): the formerly
 * static "Statistiken — bald verfügbar" placeholder is replaced by a
 * live per-link analytics surface — an always-visible "Internes Tracking"
 * card with an optimistic toggle, plus a data section rendering exactly
 * one of four mutually-exclusive states (tracking-off / loading /
 * zero-data / data), fed by `getLinkAnalytics`.
 *
 * Toast pattern: per-view ref + setTimeout (04-PATTERNS.md), no global
 * store. Because delete navigates away (unmounting this view), the toast
 * is shown FIRST and navigation is deliberately delayed slightly so the
 * user sees it before the route change — no cross-page toast state is
 * introduced. The tracking toggle deliberately shows NO success toast
 * (06-UI-SPEC.md Copywriting Contract) — the immediate card state change
 * is the confirmation; only a failed toggle toasts (on revert).
 */
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { DomainDTO, LinkAnalyticsDTO, LinkDTO } from "@kurzly/shared";
import {
  ApiError,
  createQrCode,
  deleteLink,
  getLink,
  getLinkAnalytics,
  listDomains,
  listQrCodes,
  mapLinkFormError,
  updateLink,
} from "../api";
import { formatDate } from "../lib/format";
import LinkFormModal from "../components/LinkFormModal.vue";

const route = useRoute();
const router = useRouter();

const link = ref<LinkDTO | null>(null);
const domains = ref<DomainDTO[]>([]);
const notFound = ref(false);
const showEditModal = ref(false);
const showDeleteDialog = ref(false);
const formError = ref<unknown>(null);

// Phase 6 (Surface A, TRACK-04): per-link analytics state. `analytics` stays
// `null` until a load resolves; `analyticsLoading` gates the skeleton state.
const analytics = ref<LinkAnalyticsDTO | null>(null);
const analyticsLoading = ref(false);

const toastMessage = ref<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMessage.value = message;
  toastTimeout = setTimeout(() => {
    toastMessage.value = null;
  }, 1700);
}

const activeDomains = computed(() => domains.value.filter((d) => d.status === "active"));
const hostname = computed(() => {
  const domainId = link.value?.domainId;
  if (!domainId) return "";
  return domains.value.find((d) => d.id === domainId)?.hostname ?? "";
});

/**
 * Phase 8 (08-06 Task 2, 08-UI-SPEC.md Surface D): whether the loaded link
 * carries any of the three UTM fields — drives the "UTM-Parameter gesetzt"
 * chip. Same predicate shape as LinksView.vue's hasUtm, computed here
 * against the single loaded `link` ref instead of a table row.
 */
const hasUtm = computed(
  () => !!(link.value?.utmSource || link.value?.utmMedium || link.value?.utmCampaign),
);

/**
 * Phase 8 (08-06 Task 2, 08-UI-SPEC.md Surface D): whether the loaded link
 * carries any of the three custom-OG fields — drives the "Custom OG-Tags"
 * chip.
 */
const hasOg = computed(
  () => !!(link.value?.ogTitle || link.value?.ogDescription || link.value?.ogImageUrl),
);

// 06-UI-SPEC.md Copywriting Contract: locked ON/OFF hint copy for the
// "Internes Tracking" card.
const trackingHint = computed(() =>
  link.value?.trackingEnabled
    ? "Klicks, Referrer und Länder werden erfasst (nur intern, keine Drittanbieter)."
    : "Keine Datenerfassung für diesen Link.",
);

// Phase 6 (Surface A, TRACK-04): totalClicks gates the data/zero-data
// branch — sourced from the analytics DTO's `totalClicks`
// (lifetimeClicks-derived server-side, D-13), never a live count (per this
// plan's explicit prohibition).
const totalClicks = computed(() => analytics.value?.totalClicks ?? 0);

/**
 * 30-bar chart data (06-UI-SPEC.md: `.bar { height:{{pct}}%; min-height:3px }`).
 * `pct` is scaled against the series' own max count; the CSS `min-height:3px`
 * (not this computed) provides the visual floor for zero/near-zero days, so
 * `pct` is left at its true proportional value (0% for a zero-count day).
 */
const chartBars = computed(() => {
  const series = analytics.value?.dailySeries ?? [];
  const max = series.reduce((m, d) => Math.max(m, d.count), 0);
  return series.map((d) => ({
    day: d.day,
    count: d.count,
    pct: max > 0 ? (d.count / max) * 100 : 0,
  }));
});

/** Shared row-shape builder for the Referrer/Länder `.list-row`s (row-bar-fill scaled to each list's own max, D-07/D-04 null → label at the view boundary). */
function toListRows<T extends { count: number }>(
  entries: T[],
  nameOf: (entry: T) => string,
): { name: string; count: number; pct: number }[] {
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0);
  return entries.map((e) => ({
    name: nameOf(e),
    count: e.count,
    pct: max > 0 ? (e.count / max) * 100 : 0,
  }));
}

// D-07: a null referrer host means a direct visit — labeled "Direkt" here,
// not in the DTO (raw data stays locale-neutral, RESEARCH Anti-Patterns).
const referrerRows = computed(() =>
  toListRows(analytics.value?.topReferrers ?? [], (r) => r.host ?? "Direkt"),
);
// D-04: a null country means an unresolvable IP — labeled "Unbekannt" here;
// the click itself was still counted server-side, never skipped.
const countryRows = computed(() =>
  toListRows(analytics.value?.topCountries ?? [], (c) => c.country ?? "Unbekannt"),
);

async function loadDomains(): Promise<void> {
  try {
    domains.value = await listDomains();
  } catch {
    // Non-fatal — hostname resolution just stays blank; the detail data
    // itself does not depend on this call succeeding.
  }
}

/**
 * Fetches per-link analytics (06-UI-SPEC.md Surface A, TRACK-04) — only
 * called while tracking is enabled. Follows the same try/catch +
 * `ApiError`-status-check + toast-fallback shape as `load()`; a failure
 * here does not affect `link`/`notFound`, only `analytics` stays `null`
 * and the toast informs the user.
 */
async function loadAnalytics(): Promise<void> {
  if (!link.value || !link.value.trackingEnabled) return;
  analyticsLoading.value = true;
  try {
    analytics.value = await getLinkAnalytics(link.value.id);
  } catch {
    showToast("Analytics konnten nicht geladen werden.");
  } finally {
    analyticsLoading.value = false;
  }
}

async function load(): Promise<void> {
  const id = route.params.id as string;
  try {
    link.value = await getLink(id);
    await loadAnalytics();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
      return;
    }
    showToast("Link konnte nicht geladen werden.");
  }
}

/**
 * Tracking-card toggle (06-UI-SPEC.md Surface A, TRACK-01, D-15
 * single-write-path, T-06-TOGGLEUI): flips `trackingEnabled` on `link`
 * immediately (optimistic, cosmetic-only), then PATCHes through the
 * existing `updateLink` client — the authoritative source of truth. On
 * success there is NO toast (the state change itself is the
 * confirmation); on failure the flip reverts and a toast informs the
 * user. Turning tracking back on re-fetches analytics; turning it off
 * clears the previously-loaded analytics so a later re-enable never
 * flashes stale data.
 */
async function toggleTracking(): Promise<void> {
  if (!link.value) return;
  const current = link.value;
  const next = !current.trackingEnabled;
  current.trackingEnabled = next;
  try {
    const updated = await updateLink(current.id, { trackingEnabled: next });
    link.value = updated;
    if (next) {
      await loadAnalytics();
    } else {
      analytics.value = null;
    }
  } catch {
    current.trackingEnabled = !next;
    showToast("Tracking konnte nicht geändert werden.");
  }
}

/**
 * 07-09 (07-UI-SPEC.md Surface B, QR-01): "QR-Code" entry-point button —
 * a static QR is 1:1 bound to this Link. `GET /api/qr-codes` has no
 * by-link filter param, so an existing static QR is looked up via
 * `listQrCodes()` + a client-side filter (linkId + variant==="static").
 * If found, this is a pure navigation side-effect (deep-link into the QR
 * Studio, no dialog). If none exists, create one on the spot — mirrors
 * "+ Dynamischer QR"'s instant-action philosophy — then deep-link and
 * toast. Domain/IDOR scoping is already guaranteed server-side (the link
 * itself was loaded via getLink's IDOR-guarded lookup); createQrCode/
 * listQrCodes independently re-check requireDomainAccess regardless
 * (T-07-IDOR) — no extra client-side authorization check is added here.
 */
async function handleQrCode(): Promise<void> {
  if (!link.value) return;
  const currentLink = link.value;
  try {
    const existingQrCodes = await listQrCodes();
    const existing = existingQrCodes.find(
      (qr) => qr.variant === "static" && qr.linkId === currentLink.id,
    );
    if (existing) {
      router.push({ name: "qr-codes", query: { selected: existing.id } });
      return;
    }
    const created = await createQrCode({
      variant: "static",
      linkId: currentLink.id,
      name: `QR für /${currentLink.slug}`,
    });
    router.push({ name: "qr-codes", query: { selected: created.id } });
    showToast("QR-Code erstellt");
  } catch {
    showToast("QR-Code konnte nicht erstellt werden.");
  }
}

async function handleCopy(): Promise<void> {
  if (!link.value) return;
  const url = `https://${hostname.value}/${link.value.slug}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link kopiert");
  } catch {
    showToast("Kopieren fehlgeschlagen");
  }
}

// WR-09 fix (04-REVIEW.md): `mapLinkFormError` returns `{}` for ANY error
// it cannot render as an inline field error — not just a raw network
// failure (non-ApiError), but also an `ApiError` whose `code` this mapper
// has no case for. Either way the modal would otherwise show NOTHING: no
// inline error, no toast, submission just silently does nothing. Falling
// back to a toast whenever no field error was produced closes that gap
// completely.
function reportFormError(err: unknown): void {
  formError.value = err;
  const mapped = mapLinkFormError(err);
  // Phase 8 (08-06, Rule 1 fix): the original WR-09 check only looked at
  // targetUrlError/slugError, so a mapped UTM/OG field error (e.g.
  // OG_IMAGE_URL_INVALID) would render its inline message AND still fire
  // the generic fallback toast — checking every mapped key closes that gap.
  const hasFieldError = Object.values(mapped).some((v) => v !== undefined);
  if (!hasFieldError) {
    showToast("Speichern fehlgeschlagen. Bitte erneut versuchen.");
  }
}

function openEditModal(): void {
  formError.value = null;
  showEditModal.value = true;
}

function closeEditModal(): void {
  showEditModal.value = false;
  formError.value = null;
}

async function handleEditSubmit(payload: {
  targetUrl: string;
  slug?: string;
  /** Phase 5 (D-02): `undefined` keeps, `null` clears, a string re-hashes and replaces. */
  password?: string | null;
  /** Phase 5 (D-03): `undefined` keeps, `null` clears, `YYYY-MM-DD` sets. */
  expiresAt?: string | null;
  /** Phase 5 (D-12): `undefined` keeps the current value. */
  forwardQuery?: boolean;
  /**
   * Phase 8 (08-06, D-08-05, META-01/02): forwarded EXACTLY as received —
   * `undefined` keeps, `null` is an explicit clear that must reach the
   * API rather than being collapsed away (T-08-CLEAR-DROP).
   */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
}): Promise<void> {
  if (!link.value) return;
  if (!payload.targetUrl.trim()) {
    showToast("Bitte Ziel-URL angeben.");
    return;
  }

  try {
    const updated = await updateLink(link.value.id, {
      targetUrl: payload.targetUrl.trim(),
      slug: payload.slug,
      password: payload.password,
      expiresAt: payload.expiresAt,
      forwardQuery: payload.forwardQuery,
      utmSource: payload.utmSource,
      utmMedium: payload.utmMedium,
      utmCampaign: payload.utmCampaign,
      ogTitle: payload.ogTitle,
      ogDescription: payload.ogDescription,
      ogImageUrl: payload.ogImageUrl,
    });
    link.value = updated;
    closeEditModal();
    showToast("Änderungen gespeichert");
  } catch (err) {
    reportFormError(err);
  }
}

function requestDelete(): void {
  showDeleteDialog.value = true;
}

function cancelDelete(): void {
  showDeleteDialog.value = false;
}

async function confirmDelete(): Promise<void> {
  if (!link.value) return;
  try {
    await deleteLink(link.value.id);
    showDeleteDialog.value = false;
    showToast("Link gelöscht");
    // Deliberate short delay (per-view toast pattern, no global store) so
    // the toast is visible before this view unmounts on navigation.
    setTimeout(() => {
      router.push({ name: "links" });
    }, 900);
  } catch {
    showToast("Link konnte nicht gelöscht werden.");
  }
}

function goBack(): void {
  router.push({ name: "links" });
}

load();
loadDomains();
</script>

<template>
  <div v-if="notFound" class="screen-container">
    <div class="not-found-card">
      <h3 class="empty-heading">Link nicht gefunden</h3>
      <p class="empty-body">Dieser Link existiert nicht oder ist nicht zugänglich.</p>
      <button type="button" class="back-link" @click="goBack">← Alle Links</button>
    </div>
  </div>

  <div v-else-if="link" class="screen-container">
    <button type="button" class="back-link" @click="goBack">← Alle Links</button>

    <div class="header-row">
      <div class="title-block">
        <div class="link-slug">/{{ link.slug }}</div>
        <div class="link-target">➜ {{ link.targetUrl }}</div>
      </div>
      <div class="spacer"></div>
      <div class="actions">
        <button type="button" class="action-button" @click="handleQrCode">QR-Code</button>
        <button type="button" class="action-button" @click="handleCopy">⧉ Kopieren</button>
        <button type="button" class="action-button" @click="openEditModal">✎ Bearbeiten</button>
        <button type="button" class="action-button delete" @click="requestDelete">
          🗑 Löschen
        </button>
      </div>
    </div>

    <div class="chips-row">
      <span class="chip">{{ hostname }}</span>
      <span class="chip">erstellt {{ formatDate(link.createdAt) }}</span>
      <span v-if="hasUtm" class="chip">UTM-Parameter gesetzt</span>
      <span v-if="hasOg" class="chip">Custom OG-Tags</span>
    </div>

    <!-- Surface A (06-UI-SPEC.md): always-visible tracking card + optimistic toggle. -->
    <div class="tracking-card">
      <div class="tracking-text">
        <div class="tracking-title">Internes Tracking</div>
        <div class="tracking-hint">{{ trackingHint }}</div>
      </div>
      <div
        class="toggle"
        :class="{ active: link.trackingEnabled }"
        role="switch"
        :aria-checked="link.trackingEnabled"
        @click="toggleTracking"
      >
        <div class="toggle-knob"></div>
      </div>
    </div>

    <!-- Data section — exactly one of four mutually-exclusive states. -->
    <div v-if="!link.trackingEnabled" class="dashed-empty">
      Tracking ist für diesen Link deaktiviert — es werden keine Klickdaten gespeichert.
    </div>
    <div v-else-if="analyticsLoading" class="data-section">
      <div class="stat-grid">
        <div v-for="n in 3" :key="n" class="stat-card">
          <div class="skeleton-block skeleton-stat-label"></div>
          <div class="skeleton-block skeleton-stat-value"></div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Klicks · letzte 30 Tage</div>
        <div class="skeleton-block skeleton-chart"></div>
      </div>
      <div class="two-col">
        <div class="list-card">
          <div class="list-title">Referrer</div>
          <div v-for="n in 5" :key="n" class="list-row skeleton-list-row">
            <div class="skeleton-block skeleton-row-name"></div>
            <div class="skeleton-block skeleton-row-bar"></div>
            <div class="skeleton-block skeleton-row-pct"></div>
          </div>
        </div>
        <div class="list-card">
          <div class="list-title">Länder</div>
          <div v-for="n in 5" :key="n" class="list-row skeleton-list-row">
            <div class="skeleton-block skeleton-row-name"></div>
            <div class="skeleton-block skeleton-row-bar"></div>
            <div class="skeleton-block skeleton-row-pct"></div>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="totalClicks === 0" class="data-section">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Klicks gesamt</div>
          <div class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Letzte 7 Tage</div>
          <div class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Top Referrer</div>
          <div class="stat-value">–</div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Klicks · letzte 30 Tage</div>
        <div class="zero-data-hint">
          Noch keine Klicks erfasst — Daten erscheinen, sobald der Link aufgerufen wird.
        </div>
      </div>
      <div class="two-col">
        <div class="list-card">
          <div class="list-title">Referrer</div>
          <div class="list-empty-row">Keine Daten</div>
        </div>
        <div class="list-card">
          <div class="list-title">Länder</div>
          <div class="list-empty-row">Keine Daten</div>
        </div>
      </div>
    </div>
    <div v-else class="data-section">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Klicks gesamt</div>
          <div class="stat-value">{{ totalClicks }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Letzte 7 Tage</div>
          <div class="stat-value">{{ analytics?.last7Days ?? 0 }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Top Referrer</div>
          <div class="stat-value">{{ analytics?.topReferrer ?? "–" }}</div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Klicks · letzte 30 Tage</div>
        <div class="chart-bars">
          <div
            v-for="bar in chartBars"
            :key="bar.day"
            class="bar"
            :style="{ height: bar.pct + '%' }"
            :title="`${formatDate(bar.day)}: ${bar.count} Klicks`"
          ></div>
        </div>
      </div>
      <div class="two-col">
        <div class="list-card">
          <div class="list-title">Referrer</div>
          <div v-for="row in referrerRows" :key="row.name" class="list-row">
            <div class="row-name">{{ row.name }}</div>
            <div class="row-bar-track">
              <div class="row-bar-fill" :style="{ width: row.pct + '%' }"></div>
            </div>
            <div class="row-pct">{{ Math.round(row.pct) }}%</div>
          </div>
        </div>
        <div class="list-card">
          <div class="list-title">Länder</div>
          <div v-for="row in countryRows" :key="row.name" class="list-row">
            <div class="row-name">{{ row.name }}</div>
            <div class="row-bar-track">
              <div class="row-bar-fill" :style="{ width: row.pct + '%' }"></div>
            </div>
            <div class="row-pct">{{ Math.round(row.pct) }}%</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <LinkFormModal
    v-if="showEditModal && link"
    mode="edit"
    :domains="activeDomains"
    :domain-hostname="hostname"
    :initial-target-url="link.targetUrl"
    :initial-slug="link.slug"
    :initial-domain-id="link.domainId"
    :initial-password-protected="link.passwordProtected"
    :initial-expires-at="link.expiresAt ? link.expiresAt.slice(0, 10) : null"
    :initial-forward-query="link.forwardQuery"
    :initial-utm-source="link.utmSource ?? undefined"
    :initial-utm-medium="link.utmMedium ?? undefined"
    :initial-utm-campaign="link.utmCampaign ?? undefined"
    :initial-og-title="link.ogTitle ?? undefined"
    :initial-og-description="link.ogDescription ?? undefined"
    :initial-og-image-url="link.ogImageUrl ?? undefined"
    :error="formError"
    @close="closeEditModal"
    @submit="handleEditSubmit"
  />

  <div v-if="showDeleteDialog && link" class="delete-dialog-overlay" @click="cancelDelete">
    <div class="delete-dialog" @click.stop>
      <h3 class="delete-title">Link löschen?</h3>
      <p class="delete-body">
        {{ hostname }}/{{ link.slug }} wird gelöscht. Bestehende Aufrufe dieses Links leiten
        danach nicht mehr weiter.
      </p>
      <div class="delete-footer">
        <button type="button" class="cancel-button" @click="cancelDelete">Abbrechen</button>
        <button type="button" class="delete-confirm-button" @click="confirmDelete">Löschen</button>
      </div>
    </div>
  </div>

  <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
</template>

<style scoped>
.screen-container {
  max-width: 1060px;
  margin: 0 auto;
  padding: 24px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.back-link {
  font-size: 12.5px;
  color: var(--mut);
  cursor: pointer;
  width: fit-content;
  background: none;
  border: none;
  padding: 0;
}

.back-link:hover {
  color: var(--text);
}

.header-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  flex-wrap: wrap;
}

.title-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.link-slug {
  font-size: 22px;
  font-weight: 600;
  font-family: "Geist Mono", monospace;
  letter-spacing: -0.01em;
}

.link-target {
  font-size: 12.5px;
  color: var(--mut);
  font-family: "Geist Mono", monospace;
  word-break: break-all;
}

.spacer {
  flex: 1;
}

.actions {
  display: flex;
  gap: 8px;
}

.action-button {
  padding: 7px 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 12.5px;
  cursor: pointer;
}

.action-button:hover {
  background: var(--hover);
}

.action-button.delete:hover {
  border-color: #e5484d;
  color: #e5484d;
  background: var(--panel);
}

.chips-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.chip {
  font-size: 11.5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--mut);
}

/* Surface A (06-UI-SPEC.md § Layout Contract — Surface A): tracking card +
   optimistic toggle, always visible regardless of trackingEnabled. */
.tracking-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 16px;
}

.tracking-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tracking-title {
  font-size: 13.5px;
  font-weight: 500;
}

.tracking-hint {
  font-size: 12px;
  color: var(--mut);
}

/* Toggle shape/tokens reused verbatim from LinkFormModal.vue's
   forwardQuery/tracking toggles (06-UI-SPEC.md § C1) — each component owns
   its own scoped copy, no new toggle CSS invented here. */
.toggle {
  width: 38px;
  height: 21px;
  border-radius: 999px;
  background: var(--border);
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
  flex: none;
}

.toggle.active {
  background: var(--accent);
}

.toggle-knob {
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
}

.toggle.active .toggle-knob {
  left: 19px;
}

/* Tracking-off empty state — the ONLY thing shown when trackingEnabled is
   false (never co-rendered with the stat cards below). */
.dashed-empty {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  color: var(--mut);
  font-size: 13px;
  background: var(--panel);
}

/* Data section — shared shell for the loading/zero-data/data states. */
.data-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.stat-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 11.5px;
  color: var(--mut);
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  font-family: "Geist Mono", monospace;
}

.chart-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chart-title {
  font-size: 12.5px;
  color: var(--mut);
}

.chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 130px;
}

.bar {
  flex: 1;
  background: var(--chip);
  border-radius: 3px 3px 0 0;
  min-height: 3px;
}

.bar:hover {
  background: var(--accent);
}

.zero-data-hint {
  height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12.5px;
  color: var(--mut);
  padding: 0 24px;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.list-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list-title {
  font-size: 12.5px;
  color: var(--mut);
}

.list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}

.row-name {
  width: 90px;
  flex: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-bar-track {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--chip);
  overflow: hidden;
}

.row-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
}

.row-pct {
  width: 38px;
  text-align: right;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
  font-size: 11.5px;
}

.list-empty-row {
  padding: 12px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--mut);
}

/* Loading skeleton (06-UI-SPEC.md § Loading State) — identical card shells
   to the Data State, grey placeholder blocks instead of content, no
   spinner. */
.skeleton-block {
  background: var(--chip);
  border-radius: 4px;
}

.skeleton-stat-label {
  width: 60%;
  height: 11px;
}

.skeleton-stat-value {
  width: 50%;
  height: 18px;
  margin-top: 4px;
}

.skeleton-chart {
  width: 100%;
  height: 130px;
}

.skeleton-list-row {
  gap: 10px;
}

.skeleton-row-name {
  width: 90px;
  height: 12px;
}

.skeleton-row-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
}

.skeleton-row-pct {
  width: 38px;
  height: 12px;
}

.not-found-card {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: var(--panel);
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}

.empty-heading {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.empty-body {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

/* Delete confirmation dialog (reused shell, 03-UI-SPEC.md). */
.delete-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.delete-dialog {
  width: 380px;
  background: var(--panel);
  border-radius: 16px;
  padding: 26px 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.delete-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--text);
}

.delete-body {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

.delete-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.cancel-button {
  padding: 9px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.cancel-button:hover {
  background: var(--hover);
}

.delete-confirm-button {
  padding: 9px 16px;
  border: none;
  border-radius: 8px;
  background: #e5484d;
  color: #f1f1ec;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.delete-confirm-button:hover {
  opacity: 0.85;
}

/* Toast (global pattern, reused). */
.toast {
  position: fixed;
  bottom: 26px;
  left: 50%;
  transform: translateX(-50%);
  background: #1b1b18;
  color: #f1f1ec;
  font-size: 12.5px;
  padding: 9px 16px;
  border-radius: 999px;
  z-index: 100;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  font-family: "Geist Mono", monospace;
}
</style>
