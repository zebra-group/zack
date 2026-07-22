<script setup lang="ts">
/**
 * Links list screen (04-UI-SPEC.md Links-Liste, LINK-03/04/06/07,
 * UI-06) — replaces ComingSoonView at route /links. Search + domain-
 * filter tabs are server-driven (D-03): every keystroke/tab click
 * re-fetches via listLinks({ q, domainId }) rather than filtering a
 * client-cached array, so the list always reflects only what the scoped
 * API returns (T-04-UIAUTHZ — the UI never fabricates access).
 *
 * Toast pattern: per-view ref + setTimeout (04-PATTERNS.md), no global
 * store. Delete confirm dialog + toast shell reused from DomainsView.vue.
 */
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { DomainDTO, LinkDTO } from "@kurzly/shared";
import { createLink, deleteLink, listDomains, listLinks, mapLinkFormError, updateLink } from "../api";
import { formatDate } from "../lib/format";
import LinkFormModal from "../components/LinkFormModal.vue";

const router = useRouter();

const links = ref<LinkDTO[]>([]);
const domains = ref<DomainDTO[]>([]);
const searchQuery = ref("");
const selectedDomainId = ref<string | null>(null);

const showCreateModal = ref(false);
const editTarget = ref<LinkDTO | null>(null);
const deleteTarget = ref<LinkDTO | null>(null);
const formError = ref<unknown>(null);

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
const isFiltering = computed(() => searchQuery.value.trim() !== "" || selectedDomainId.value !== null);

function hostnameFor(domainId: string): string {
  return domains.value.find((d) => d.id === domainId)?.hostname ?? "";
}

/**
 * Phase 8 (08-06 Task 1, 08-UI-SPEC.md Surface C): whether a link carries
 * any of the three UTM fields — drives the "UTM" attribute badge.
 */
function hasUtm(link: LinkDTO): boolean {
  return !!(link.utmSource || link.utmMedium || link.utmCampaign);
}

/**
 * Phase 8 (08-06 Task 1, 08-UI-SPEC.md Surface C): whether a link carries
 * any of the three custom-OG fields — drives the "OG" attribute badge.
 */
function hasOg(link: LinkDTO): boolean {
  return !!(link.ogTitle || link.ogDescription || link.ogImageUrl);
}

async function loadDomains(): Promise<void> {
  try {
    domains.value = await listDomains();
  } catch {
    showToast("Domains konnten nicht geladen werden.");
  }
}

// WR-08 fix (04-REVIEW.md): `requestId` guards against out-of-order
// responses — every call to loadLinks() stamps a monotonically increasing
// id and only applies its result if it is still the MOST RECENT call by
// the time its response resolves. Without this, a slow earlier response
// (e.g. for "a") could resolve AFTER a faster later one (e.g. for "abc")
// and silently overwrite the UI with stale data — a classic race for any
// live-search input backed by a real network request per keystroke.
let requestId = 0;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SEARCH_DEBOUNCE_MS = 250;

async function loadLinks(): Promise<void> {
  const thisRequest = ++requestId;
  try {
    const params: { q?: string; domainId?: string } = {};
    if (searchQuery.value.trim()) params.q = searchQuery.value.trim();
    if (selectedDomainId.value) params.domainId = selectedDomainId.value;
    const result = await listLinks(params);
    if (thisRequest === requestId) links.value = result;
  } catch {
    if (thisRequest === requestId) showToast("Links konnten nicht geladen werden.");
  }
}

// Debounced search input handler — reduces request volume on fast typing;
// the requestId guard above still protects against any residual
// out-of-order resolution even within the debounce window (e.g. two
// requests that both survive because the user paused, then resumed).
function handleSearchInput(): void {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadLinks();
  }, SEARCH_DEBOUNCE_MS);
}

function selectDomain(domainId: string | null): void {
  selectedDomainId.value = domainId;
  loadLinks();
}

// WR-09 fix (04-REVIEW.md): `mapLinkFormError` returns `{}` for ANY error
// it cannot render as an inline field error — not just a raw network
// failure (non-ApiError), but also an `ApiError` whose `code` this
// mapper has no case for (e.g. a 403 the modal has no dedicated field
// for). Either way the modal would otherwise show NOTHING: no inline
// error, no toast, submission just silently does nothing. Falling back to
// a toast whenever no field error was produced closes that gap
// completely, not only the non-ApiError slice of it.
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

function openCreateModal(): void {
  formError.value = null;
  showCreateModal.value = true;
}

function closeCreateModal(): void {
  showCreateModal.value = false;
  formError.value = null;
}

async function handleCreateSubmit(payload: {
  domainId?: string;
  targetUrl: string;
  slug?: string;
  /** Phase 5 (D-02): plaintext, hashed server-side; `null` never occurs in create mode. */
  password?: string | null;
  /** Phase 5 (D-03): `YYYY-MM-DD`; `null` never occurs in create mode. */
  expiresAt?: string | null;
  /** Phase 5 (D-12). */
  forwardQuery?: boolean;
  /** Phase 6 (TRACK-01/D-15): omitted server-side defaults to `true`. */
  trackingEnabled?: boolean;
  /**
   * Phase 8 (08-06, D-08-05, META-01/02): the modal's `keepClearOrSet`
   * never emits `null` in create mode (there is no "initial value" to
   * clear), but `CreateLinkInput` has no `null` variant at all — collapse
   * it to `undefined` at this call site regardless, per plan Task 1.
   */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
}): Promise<void> {
  if (!payload.targetUrl.trim()) {
    showToast("Bitte Ziel-URL angeben.");
    return;
  }
  if (!payload.domainId) {
    showToast("Bitte eine Domain auswählen.");
    return;
  }

  try {
    const created = await createLink({
      domainId: payload.domainId,
      targetUrl: payload.targetUrl.trim(),
      slug: payload.slug,
      // CreateLinkInput has no `null` variant for password/expiresAt (D-01) —
      // the modal never emits null in create mode anyway, but `?? undefined`
      // keeps this call site type-safe regardless.
      password: payload.password ?? undefined,
      expiresAt: payload.expiresAt ?? undefined,
      forwardQuery: payload.forwardQuery,
      trackingEnabled: payload.trackingEnabled,
      utmSource: payload.utmSource ?? undefined,
      utmMedium: payload.utmMedium ?? undefined,
      utmCampaign: payload.utmCampaign ?? undefined,
      ogTitle: payload.ogTitle ?? undefined,
      ogDescription: payload.ogDescription ?? undefined,
      ogImageUrl: payload.ogImageUrl ?? undefined,
    });
    links.value.unshift(created);
    closeCreateModal();
    showToast(`${hostnameFor(created.domainId)}/${created.slug} erstellt`);
  } catch (err) {
    reportFormError(err);
  }
}

function requestEdit(link: LinkDTO): void {
  formError.value = null;
  editTarget.value = link;
}

function closeEditModal(): void {
  editTarget.value = null;
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
  /** Phase 6 (TRACK-01/D-15): `undefined` keeps the current value. */
  trackingEnabled?: boolean;
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
  const target = editTarget.value;
  if (!target) return;
  if (!payload.targetUrl.trim()) {
    showToast("Bitte Ziel-URL angeben.");
    return;
  }

  try {
    const updated = await updateLink(target.id, {
      targetUrl: payload.targetUrl.trim(),
      slug: payload.slug,
      password: payload.password,
      expiresAt: payload.expiresAt,
      forwardQuery: payload.forwardQuery,
      trackingEnabled: payload.trackingEnabled,
      utmSource: payload.utmSource,
      utmMedium: payload.utmMedium,
      utmCampaign: payload.utmCampaign,
      ogTitle: payload.ogTitle,
      ogDescription: payload.ogDescription,
      ogImageUrl: payload.ogImageUrl,
    });
    const idx = links.value.findIndex((l) => l.id === updated.id);
    if (idx !== -1) links.value[idx] = updated;
    closeEditModal();
    showToast("Änderungen gespeichert");
  } catch (err) {
    reportFormError(err);
  }
}

function requestDelete(link: LinkDTO): void {
  deleteTarget.value = link;
}

function cancelDelete(): void {
  deleteTarget.value = null;
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;

  try {
    await deleteLink(target.id);
    links.value = links.value.filter((l) => l.id !== target.id);
    deleteTarget.value = null;
    showToast("Link gelöscht");
  } catch {
    showToast("Link konnte nicht gelöscht werden.");
  }
}

async function handleCopy(link: LinkDTO): Promise<void> {
  const url = `https://${hostnameFor(link.domainId)}/${link.slug}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link kopiert");
  } catch {
    showToast("Kopieren fehlgeschlagen");
  }
}

function openDetail(link: LinkDTO): void {
  router.push({ name: "link-detail", params: { id: link.id } });
}

function goToImport(): void {
  router.push({ name: "links-import" });
}

loadDomains();
loadLinks();
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>Links</h1>
      <p class="counter">{{ links.length }} Links</p>
      <div class="spacer"></div>
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="Suchen…"
        @input="handleSearchInput"
      />
      <button type="button" class="import-button" @click="goToImport">Import</button>
      <button type="button" class="primary-button" @click="openCreateModal">+ Neuer Link</button>
    </div>

    <div class="domain-tabs">
      <button
        type="button"
        class="tab-pill"
        :class="{ active: selectedDomainId === null }"
        @click="selectDomain(null)"
      >
        alle Domains
      </button>
      <button
        v-for="domain in activeDomains"
        :key="domain.id"
        type="button"
        class="tab-pill"
        :class="{ active: selectedDomainId === domain.id }"
        @click="selectDomain(domain.id)"
      >
        {{ domain.hostname }}
      </button>
    </div>

    <div v-if="links.length === 0 && !isFiltering" class="empty-state">
      <div class="empty-icon">🔗</div>
      <h3 class="empty-heading">Noch keine Links</h3>
      <p class="empty-body">Erstelle deinen ersten Kurzlink oder importiere mehrere per CSV.</p>
    </div>

    <div v-else class="links-card">
      <div class="table-header">
        <span>Kurzlink</span>
        <span>Domain</span>
        <span>Ziel</span>
        <span class="col-clicks">Klicks</span>
        <span>Erstellt</span>
        <span></span>
      </div>

      <div v-if="links.length === 0" class="no-match">
        Keine Links gefunden. Passe Suche oder Domain-Filter an.
      </div>

      <div
        v-for="link in links"
        :key="link.id"
        class="table-row"
        @click="openDetail(link)"
      >
        <span class="cell-slug">
          <span class="cell-slug-text">/{{ link.slug }}</span>
          <span v-if="hasUtm(link)" class="attr-badge">UTM</span>
          <span v-if="hasOg(link)" class="attr-badge">OG</span>
          <span v-if="!link.trackingEnabled" class="attr-badge">Tracking aus</span>
        </span>
        <span class="cell-domain">{{ hostnameFor(link.domainId) }}</span>
        <span class="cell-target">{{ link.targetUrl }}</span>
        <span class="cell-clicks" :class="{ 'tracking-off': !link.trackingEnabled }">
          {{ link.trackingEnabled ? link.lifetimeClicks.toLocaleString("de-DE") : "—" }}
        </span>
        <span class="cell-created">{{ formatDate(link.createdAt) }}</span>
        <span class="cell-actions">
          <button type="button" class="row-action" title="Kopieren" @click.stop="handleCopy(link)">
            ⧉
          </button>
          <button
            type="button"
            class="row-action"
            title="Bearbeiten"
            @click.stop="requestEdit(link)"
          >
            ✎
          </button>
          <button
            type="button"
            class="row-action delete"
            title="Löschen"
            @click.stop="requestDelete(link)"
          >
            🗑
          </button>
          <span class="chevron">›</span>
        </span>
      </div>
    </div>
  </div>

  <LinkFormModal
    v-if="showCreateModal"
    mode="create"
    :domains="activeDomains"
    :error="formError"
    @close="closeCreateModal"
    @submit="handleCreateSubmit"
  />

  <LinkFormModal
    v-if="editTarget"
    mode="edit"
    :domains="activeDomains"
    :domain-hostname="hostnameFor(editTarget.domainId)"
    :initial-target-url="editTarget.targetUrl"
    :initial-slug="editTarget.slug"
    :initial-domain-id="editTarget.domainId"
    :initial-password-protected="editTarget.passwordProtected"
    :initial-expires-at="editTarget.expiresAt ? editTarget.expiresAt.slice(0, 10) : null"
    :initial-forward-query="editTarget.forwardQuery"
    :initial-tracking-enabled="editTarget.trackingEnabled"
    :initial-utm-source="editTarget.utmSource ?? undefined"
    :initial-utm-medium="editTarget.utmMedium ?? undefined"
    :initial-utm-campaign="editTarget.utmCampaign ?? undefined"
    :initial-og-title="editTarget.ogTitle ?? undefined"
    :initial-og-description="editTarget.ogDescription ?? undefined"
    :initial-og-image-url="editTarget.ogImageUrl ?? undefined"
    :error="formError"
    @close="closeEditModal"
    @submit="handleEditSubmit"
  />

  <div v-if="deleteTarget" class="delete-dialog-overlay" @click="cancelDelete">
    <div class="delete-dialog" @click.stop>
      <h3 class="delete-title">Link löschen?</h3>
      <p class="delete-body">
        {{ hostnameFor(deleteTarget.domainId) }}/{{ deleteTarget.slug }} wird gelöscht. Bestehende
        Aufrufe dieses Links leiten danach nicht mehr weiter.
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
  padding: 28px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.screen-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.screen-header h1 {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

.counter {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

.spacer {
  flex: 1;
}

.search-input {
  width: 220px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  font-size: 13px;
  color: var(--text);
}

.import-button {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.import-button:hover {
  background: var(--hover);
}

.primary-button {
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #1b1b18;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.primary-button:hover {
  opacity: 0.85;
}

.domain-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tab-pill {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  cursor: pointer;
  background: var(--panel);
  color: var(--mut);
  font-weight: 400;
  border: 1px solid var(--border);
}

.tab-pill.active {
  background: var(--accent);
  color: #1b1b18;
  font-weight: 600;
  border-color: var(--accent);
}

.links-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.table-header {
  display: grid;
  grid-template-columns: 140px 140px 1fr 90px 100px 132px;
  gap: 12px;
  padding: 9px 16px;
  font-size: 11px;
  color: var(--mut);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
}

/* Phase 6 (06-UI-SPEC.md § C2): "Klicks" header, right-aligned. */
.col-clicks {
  text-align: right;
}

.no-match {
  padding: 32px;
  text-align: center;
  font-size: 12.5px;
  color: var(--mut);
}

.table-row {
  display: grid;
  grid-template-columns: 140px 140px 1fr 90px 100px 132px;
  gap: 12px;
  padding: 11px 16px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.table-row:hover {
  background: var(--hover);
}

.table-row:last-child {
  border-bottom: none;
}

.cell-slug {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  row-gap: 3px;
  min-width: 0;
}

.cell-slug-text {
  font-family: "Geist Mono", monospace;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Phase 6 (06-UI-SPEC.md § C2, D-15) — neutral attribute badge, wraps onto
   a second line within the Kurzlink cell rather than truncating. Phase 8
   (08-06, 08-UI-SPEC.md Surface C): generalized from the single-badge
   `.tracking-badge` name to the shared `.attr-badge` — the UTM and OG
   badges reuse this exact rule, not a duplicate. Locked order in the
   markup: UTM -> OG -> Tracking aus. */
.attr-badge {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--mut);
  white-space: nowrap;
}

/* Phase 6 (06-UI-SPEC.md § C2, D-13) — reads Link.lifetimeClicks only,
   never a live aggregation over ClickEvent. */
.cell-clicks {
  text-align: right;
  font-family: "Geist Mono", monospace;
  font-size: 12.5px;
  color: var(--text);
}

.cell-clicks.tracking-off {
  color: var(--mut);
}

.cell-domain {
  font-family: "Geist Mono", monospace;
  font-size: 12px;
  color: var(--mut);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-target {
  font-size: 12.5px;
  color: var(--mut);
  font-family: "Geist Mono", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-created {
  font-family: "Geist Mono", monospace;
  font-size: 11.5px;
  color: var(--mut);
  white-space: nowrap;
}

.cell-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.row-action {
  font-size: 11px;
  color: var(--mut);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 1px 5px;
  cursor: pointer;
  background: transparent;
}

.row-action:hover {
  color: var(--text);
  border-color: var(--mut);
}

.row-action.delete:hover {
  color: #e5484d;
}

.chevron {
  color: var(--mut);
  font-size: 13px;
  text-align: center;
  pointer-events: none;
}

/* Empty state */
.empty-state {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: var(--panel);
}

.empty-icon {
  font-size: 24px;
  margin-bottom: 10px;
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
  margin-top: 4px;
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
