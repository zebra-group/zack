<script setup lang="ts">
/**
 * QR-Codes list + Studio screen (07-UI-SPEC.md Surface A, QR-02/03/04/07) —
 * replaces `ComingSoonView` at `/qr-codes` (router/index.ts, Task 1). This
 * is Surface A's list column + the four mutually-exclusive screen states
 * (loading/error/empty/data), built against the real QR API client
 * (Task 1's `api.ts` additions). Thumbnails render via the server-side
 * `qrRenderPngUrl` endpoint (CONTEXT single-code-path lock) — never a
 * client-side QR redraw.
 *
 * The Studio column (right, 360px) is an intentional placeholder for
 * 07-08 — only the LOCKED header (title + selected QR's code) is rendered
 * here; the preview/controls/export UI is out of this plan's scope.
 *
 * Toast pattern: per-view ref + setTimeout (04-PATTERNS.md), no global
 * store — matches LinksView.vue/LinkDetailView.vue.
 *
 * Optimistic remap (select onChange) + the remap-history line/Verlauf
 * expander are wired in Task 3 — the select below is structural only in
 * this task (correct value/disabled state, no mutation handler yet).
 */
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import type { LinkDTO, QrCodeDTO } from "@kurzly/shared";
import { createQrCode, listLinks, listQrCodes, qrRenderPngUrl } from "../api";

const route = useRoute();

const qrCodes = ref<QrCodeDTO[]>([]);
const links = ref<LinkDTO[]>([]);
const isLoading = ref(true);
const isError = ref(false);
const selectedQrId = ref<string | null>(null);

const toastMessage = ref<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMessage.value = message;
  toastTimeout = setTimeout(() => {
    toastMessage.value = null;
  }, 1700);
}

const selectedQr = computed(
  () => qrCodes.value.find((qr) => qr.id === selectedQrId.value) ?? null,
);

/** `qr.code` for a dynamic QR (`/q/xxxx`), or the bound Link's slug for a static QR (`/{slug}`). */
function codeDisplay(qr: QrCodeDTO): string {
  if (qr.variant === "dynamic") return `/q/${qr.code}`;
  const link = links.value.find((l) => l.id === qr.linkId);
  return link ? `/${link.slug}` : "";
}

/**
 * Resolves the initial selection: the `?selected={qrId}` deep-link (if it
 * matches a loaded QR code) — otherwise the first card in the list, or
 * `null` for an empty list.
 */
function resolveInitialSelection(): void {
  const requested = route.query.selected;
  const requestedId = typeof requested === "string" ? requested : null;
  if (requestedId && qrCodes.value.some((qr) => qr.id === requestedId)) {
    selectedQrId.value = requestedId;
    return;
  }
  selectedQrId.value = qrCodes.value[0]?.id ?? null;
}

async function loadAll(): Promise<void> {
  isLoading.value = true;
  isError.value = false;
  try {
    const [qrResult, linkResult] = await Promise.all([listQrCodes(), listLinks()]);
    qrCodes.value = qrResult;
    links.value = linkResult;
    resolveInitialSelection();
  } catch {
    isError.value = true;
  } finally {
    isLoading.value = false;
  }
}

function selectCard(qr: QrCodeDTO): void {
  selectedQrId.value = qr.id;
}

/**
 * "+ Dynamischer QR" (LOCKED, no dialog): creates immediately with
 * Default-Name "Neuer QR-Code" and Default-Ziel = the first accessible
 * Link — prepends + selects the new card, toasts "Dynamischer QR
 * erstellt" (07-UI-SPEC.md Copywriting Contract). Guards against the edge
 * case the locked contract doesn't cover: no accessible Link at all means
 * there is no valid default target to create against.
 */
async function createDynamicQr(): Promise<void> {
  const defaultLinkId = links.value[0]?.id;
  if (!defaultLinkId) {
    showToast("Bitte zuerst einen Link anlegen.");
    return;
  }

  try {
    const created = await createQrCode({
      variant: "dynamic",
      linkId: defaultLinkId,
      name: "Neuer QR-Code",
    });
    qrCodes.value.unshift(created);
    selectedQrId.value = created.id;
    showToast("Dynamischer QR erstellt");
  } catch {
    showToast("Speichern fehlgeschlagen. Bitte erneut versuchen.");
  }
}

loadAll();
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>QR-Codes</h1>
      <div class="spacer"></div>
      <button type="button" class="primary-button" @click="createDynamicQr">
        + Dynamischer QR
      </button>
    </div>
    <p class="header-subtext">dynamische Codes bleiben gedruckt gültig — nur das Ziel wechselt</p>

    <!-- Genau EINER der vier Zustände (nie zwei gleichzeitig sichtbar). -->
    <div v-if="isLoading" class="loading-skeleton">
      <div class="qr-list">
        <div v-for="n in 3" :key="n" class="qr-card skeleton-card">
          <div class="card-header">
            <div class="skeleton-block skeleton-thumbnail"></div>
            <div class="meta-block">
              <div class="skeleton-block skeleton-name"></div>
              <div class="skeleton-block skeleton-code"></div>
              <div class="skeleton-block skeleton-target"></div>
            </div>
            <div class="skeleton-block skeleton-scans"></div>
          </div>
        </div>
      </div>
      <div class="studio-panel skeleton-studio">
        <div class="skeleton-block skeleton-studio-title"></div>
        <div class="skeleton-block skeleton-studio-preview"></div>
        <div class="skeleton-block skeleton-studio-control" v-for="n in 3" :key="n"></div>
        <div class="skeleton-export-row">
          <div class="skeleton-block skeleton-export-button"></div>
          <div class="skeleton-block skeleton-export-button"></div>
        </div>
      </div>
    </div>

    <div v-else-if="isError" class="error-state">
      <div class="state-icon">▦</div>
      <h3 class="state-heading">QR-Codes konnten nicht geladen werden</h3>
      <p class="state-body">Bitte lade die Seite neu oder versuche es später erneut.</p>
      <button type="button" class="retry-button" @click="loadAll">Erneut versuchen</button>
    </div>

    <div v-else-if="qrCodes.length === 0" class="empty-state">
      <div class="state-icon">▦</div>
      <h3 class="state-heading">Noch keine QR-Codes</h3>
      <p class="state-body">
        Erstelle einen dynamischen QR-Code oder füge über die Link-Detailseite einen QR-Code zu
        einem bestehenden Link hinzu.
      </p>
    </div>

    <div v-else class="data-row">
      <div class="qr-list">
        <div
          v-for="qr in qrCodes"
          :key="qr.id"
          class="qr-card"
          :class="{ selected: selectedQrId === qr.id }"
          @click="selectCard(qr)"
        >
          <div class="card-header">
            <img class="thumbnail" :src="qrRenderPngUrl(qr.id)" alt="" />
            <div class="meta-block">
              <div class="name-row">
                <span class="qr-name">{{ qr.name }}</span>
                <span class="qr-code">{{ codeDisplay(qr) }}</span>
                <span class="badge" :class="qr.variant === 'dynamic' ? 'badge-dynamic' : 'badge-static'">
                  {{ qr.variant === "dynamic" ? "DYNAMISCH" : "STATISCH" }}
                </span>
              </div>
              <div class="target-row">
                <span class="target-label">zeigt auf ➜</span>
                <select
                  class="target-select"
                  :disabled="qr.variant !== 'dynamic'"
                  :value="qr.linkId"
                  @click.stop
                >
                  <option v-for="link in links" :key="link.id" :value="link.id">/{{ link.slug }}</option>
                </select>
              </div>
            </div>
            <div class="scans-block">
              <div class="scans-value">{{ qr.lifetimeScans.toLocaleString("de-DE") }}</div>
              <div class="scans-label">Scans</div>
            </div>
          </div>
        </div>
      </div>

      <div class="studio-panel">
        <div class="studio-header">
          <h2 class="studio-title">QR-Studio</h2>
          <span v-if="selectedQr" class="studio-code">{{ codeDisplay(selectedQr) }}</span>
        </div>
      </div>
    </div>
  </div>

  <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
</template>

<style scoped>
.screen-container {
  max-width: 1120px;
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

.header-subtext {
  font-size: 12.5px;
  color: var(--mut);
  margin: -14px 0 0;
}

.spacer {
  flex: 1;
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

/* Empty/Error state (shared shell). */
.empty-state,
.error-state {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: var(--panel);
}

.state-icon {
  font-size: 24px;
  margin-bottom: 10px;
  color: var(--mut);
}

.state-heading {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.state-body {
  font-size: 12.5px;
  color: var(--mut);
  margin-top: 4px;
}

.retry-button {
  margin-top: 12px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.retry-button:hover {
  background: var(--hover);
}

/* Two-column data state. */
.data-row,
.loading-skeleton {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.qr-list {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qr-card {
  background: var(--panel);
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qr-card:hover {
  border-color: var(--mut);
}

.qr-card.selected {
  border-color: var(--accent);
}

.card-header {
  display: flex;
  gap: 14px;
  align-items: center;
}

.thumbnail {
  width: 46px;
  height: 46px;
  flex: none;
  background: #fff;
  border-radius: 6px;
  padding: 3px;
  border: 1px solid var(--border);
  object-fit: contain;
}

.meta-block {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.qr-name {
  font-size: 13.5px;
  font-weight: 500;
}

.qr-code {
  font-size: 11.5px;
  color: var(--mut);
  font-family: "Geist Mono", monospace;
}

.badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  font-weight: 600;
}

.badge-dynamic {
  background: var(--accent);
  color: #1b1b18;
}

.badge-static {
  background: var(--chip);
  color: var(--mut);
}

.target-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--mut);
}

.target-select {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-family: "Geist Mono", monospace;
  max-width: 220px;
}

.scans-block {
  text-align: right;
  flex: none;
}

.scans-value {
  font-family: "Geist Mono", monospace;
  font-size: 14px;
  font-weight: 600;
}

.scans-label {
  font-size: 11px;
  color: var(--mut);
}

/* Studio panel (placeholder shell — 07-08 fills preview/controls/export). */
.studio-panel {
  width: 360px;
  flex: none;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.studio-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.studio-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

.studio-code {
  font-size: 11.5px;
  color: var(--mut);
  font-family: "Geist Mono", monospace;
}

/* Loading skeleton. */
.skeleton-block {
  background: var(--chip);
  border-radius: 4px;
}

.skeleton-card .card-header {
  width: 100%;
}

.skeleton-thumbnail {
  width: 46px;
  height: 46px;
  border-radius: 6px;
  flex: none;
}

.skeleton-name {
  width: 120px;
  height: 13px;
}

.skeleton-code {
  width: 160px;
  height: 11px;
  margin-top: 5px;
}

.skeleton-target {
  width: 180px;
  height: 11px;
  margin-top: 5px;
}

.skeleton-scans {
  width: 32px;
  height: 14px;
  margin-left: auto;
}

.skeleton-studio {
  gap: 11px;
}

.skeleton-studio-title {
  width: 80px;
  height: 14px;
}

.skeleton-studio-preview {
  width: 196px;
  height: 196px;
  border-radius: 10px;
  align-self: center;
}

.skeleton-studio-control {
  width: 100%;
  height: 21px;
}

.skeleton-export-row {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.skeleton-export-button {
  flex: 1;
  height: 33px;
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
