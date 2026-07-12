<script setup lang="ts">
/**
 * Link detail screen (04-UI-SPEC.md Link-Detail, LINK-05/06/07, UI-06) —
 * route /links/:id. Loads the link via getLink(route.params.id); a 404
 * (ApiError, IDOR-guarded 404-for-both per 04-03) routes back to /links
 * with a toast rather than rendering a broken detail page.
 *
 * The Statistik-Platzhalter card is STATIC — no backend call. Real click
 * numbers are Phase 6 (Analytics), per 04-UI-SPEC.md's explicit scope cut.
 *
 * Toast pattern: per-view ref + setTimeout (04-PATTERNS.md), no global
 * store. Because delete navigates away (unmounting this view), the toast
 * is shown FIRST and navigation is deliberately delayed slightly so the
 * user sees it before the route change — no cross-page toast state is
 * introduced.
 */
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { DomainDTO, LinkDTO } from "@kurzly/shared";
import { ApiError, deleteLink, getLink, listDomains, mapLinkFormError, updateLink } from "../api";
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

async function loadDomains(): Promise<void> {
  try {
    domains.value = await listDomains();
  } catch {
    // Non-fatal — hostname resolution just stays blank; the detail data
    // itself does not depend on this call succeeding.
  }
}

async function load(): Promise<void> {
  const id = route.params.id as string;
  try {
    link.value = await getLink(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true;
      return;
    }
    showToast("Link konnte nicht geladen werden.");
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
  if (!mapped.targetUrlError && !mapped.slugError) {
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
    </div>

    <div class="stats-placeholder">
      <h3 class="stats-heading">Statistiken — bald verfügbar</h3>
      <p class="stats-body">
        Klick-Statistiken sind noch nicht verfügbar. Sie kommen mit der Analytics-Phase.
      </p>
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

.stats-placeholder {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: var(--panel);
}

.stats-heading {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.stats-body {
  font-size: 12.5px;
  color: var(--mut);
  margin-top: 4px;
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
