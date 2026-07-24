<script setup lang="ts">
/**
 * QR Studio panel (07-UI-SPEC.md Surface A Studio column, QR-01/05/06) —
 * the self-contained right-column component QrCodesView.vue mounts for the
 * currently selected QR code (07-07 left only a header-only placeholder
 * here). Owns its own full panel shell (width:360px, LOCKED) so
 * QrCodesView.vue simply slots it in.
 *
 * Every control change persists via `updateQrCode` (api.ts, the sole QR
 * fetch layer) and then schedules a 300ms-debounced re-fetch of the
 * server-rendered preview — this component NEVER redraws QR modules
 * itself (CONTEXT single-code-path lock; mirrors QrCodesView.vue's
 * thumbnail, which also renders via the server `render.png` endpoint).
 * The debounced re-render preloads the next image via a throwaway
 * `Image()` and only swaps the visible `<img>`'s `src` once that preload
 * resolves — so the previous frame stays on screen (at opacity .6 while
 * loading) instead of flashing blank (07-UI-SPEC.md's "no skeleton"
 * rule).
 *
 * Logo-overlay ambiguity (Claude's Discretion, see 07-08-SUMMARY.md):
 * `QrCodeDTO.logoEnabled` is a plain persisted boolean, independent of
 * whether real logo bytes are actually stored (`logoData` never crosses
 * the JSON boundary, T-07-DTO-LEAK) — so this component cannot tell,
 * from the DTO alone, whether a previously-uploaded logo already exists
 * for a freshly selected QR. It therefore only draws the decorative
 * BRAND_NAME-initial placeholder tile while `logoEnabled` is on AND no
 * logo has been uploaded THIS session (`hasCustomLogo`, reset whenever
 * the selected QR changes) — once a real logo is uploaded, the server
 * re-render already shows it composited into the actual PNG/SVG bytes,
 * so the decorative tile is suppressed rather than doubling up on top of
 * the real pixels.
 *
 * BRAND_NAME itself is a backend-only ENV var (apps/api/src/env.ts,
 * server-rendered redirect pages only) — never exposed to the frontend.
 * The rest of the SPA already hardcodes the literal "Kurzly" brand text
 * (AppShell.vue/LoginView.vue/AuthErrorView.vue) rather than reading it
 * dynamically, so the placeholder tile mirrors that same established
 * convention with a hardcoded initial instead of adding a new public
 * config endpoint (out of scope; no backend files may be touched here).
 */
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import type { QrCodeDTO, UpdateQrCodeInput } from "@kurzly/shared";
import { deleteQrCode, fetchQrRenderBlob, mapQrFormError, qrRenderPngUrl, updateQrCode } from "../api";

type QrStudioPanelProps = {
  qr: QrCodeDTO;
};

const props = defineProps<QrStudioPanelProps>();

const emit = defineEmits<{
  /** Fired after every successful style/logo mutation so QrCodesView.vue can sync its list + bust the matching thumbnail's cache. */
  styled: [updated: QrCodeDTO];
  toast: [message: string];
  /** Fired after a successful delete (WR-07) so QrCodesView.vue can remove the card + reselect. */
  deleted: [id: string];
}>();

/** LOCKED product QR-module colors (07-UI-SPEC.md) — an independent product color system, never `--accent`. */
const PRODUCT_COLORS = ["#17170f", "#1e3a5f", "#14532d", "#7c2d4f"];

const BRAND_INITIAL = "K";

const SAVE_FAILED_MESSAGE = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
const LOGO_FORMAT_ERROR = "Nur PNG oder SVG erlaubt.";
const LOGO_SIZE_ERROR = "Datei zu groß (max. 1,4 MB).";
const EXPORT_FAILED_MESSAGE = "Export fehlgeschlagen. Bitte erneut versuchen.";
// WR-07: reuses LinkDetailView.vue's Link-delete confirm dialog copy
// verbatim with "Link" -> "QR-Code" (04-05's copy-lock convention).
const DELETE_SUCCESS_MESSAGE = "QR-Code gelöscht";
const DELETE_FAILED_MESSAGE = "QR-Code konnte nicht gelöscht werden.";
/**
 * Must stay BELOW the server's effective cap, never above it. The server
 * caps the base64 `logoData` STRING at 1,900,000 chars
 * (`LOGO_DATA_MAX_LENGTH`, apps/api/src/routes/qrCodes.ts), and base64
 * inflates ~4/3 — so ~1,425,000 raw bytes is the real server ceiling. The
 * previous 2 MiB client cap sat ABOVE it, leaving a ~1.36-2.00 MiB band in
 * which the UI accepted a file and the server then rejected it with an
 * untyped 400 ("Invalid QR data", no INVALID_LOGO code) that
 * `mapQrFormError` funnels into the generic save-failure copy. Rounding
 * down to 1,400,000 keeps this check strictly inside the server's limit, so
 * an accepted file always fits.
 */
const MAX_LOGO_BYTES = 1_400_000;
const RENDER_DEBOUNCE_MS = 300;

const previewSrc = ref(qrRenderPngUrl(props.qr.id));
const isPreviewLoading = ref(false);
let renderVersion = 0;
let renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const logoFileName = ref<string | null>(null);
const hasCustomLogo = ref(false);
const logoError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const showDeleteDialog = ref(false);

/**
 * Optimistic mirror of the three styleable DTO fields this panel edits.
 *
 * These are deliberately NOT written back into `props.qr`: `QrCodesView`'s
 * `selectedQr` is a live element of its own `qrCodes` array, so assigning
 * into the prop would mutate the parent's state behind its back — while the
 * parent independently replaces that same element from the `styled` emit.
 * Two write paths for one piece of state (the exact case
 * `vue/no-mutating-props` exists to catch). Here the panel owns only the
 * pre-confirmation value; the parent stays the sole owner of the DTO, and
 * the watch below re-syncs whenever it hands down an authoritative one.
 */
const local = reactive({
  name: props.qr.name,
  color: props.qr.color,
  roundedModules: props.qr.roundedModules,
  logoEnabled: props.qr.logoEnabled,
});

watch(
  () => props.qr,
  (qr) => {
    local.name = qr.name;
    local.color = qr.color;
    local.roundedModules = qr.roundedModules;
    local.logoEnabled = qr.logoEnabled;
  },
);

const studioCode = computed(() => (props.qr.variant === "dynamic" ? `/q/${props.qr.code}` : ""));
/**
 * Only draws the decorative placeholder tile for "toggle on, nothing
 * uploaded yet" — a `qr.hasLogo` from the server means real logo bytes
 * are already composited into `previewSrc`, so drawing the tile on top
 * would hide the actual saved logo behind a generic brand-initial icon
 * (this used to happen on every reselect/reload, since `hasCustomLogo`
 * is session-local and always starts false).
 */
const showLogoOverlay = computed(() => local.logoEnabled && !hasCustomLogo.value && !props.qr.hasLogo);

/** Preloads the next server render before swapping `previewSrc` — keeps the previous frame visible (opacity .6) instead of a blank flash. */
function refreshPreview(): void {
  renderVersion += 1;
  const nextSrc = `${qrRenderPngUrl(props.qr.id)}?v=${renderVersion}`;
  isPreviewLoading.value = true;
  const preload = new Image();
  preload.onload = () => {
    previewSrc.value = nextSrc;
    isPreviewLoading.value = false;
  };
  preload.onerror = () => {
    isPreviewLoading.value = false;
  };
  preload.src = nextSrc;
}

/** T-07-DOS-RENDER mitigation: every control change schedules this instead of calling refreshPreview directly. */
function scheduleRender(): void {
  cancelScheduledRender();
  renderDebounceTimer = setTimeout(refreshPreview, RENDER_DEBOUNCE_MS);
}

/**
 * Drops any pending debounce. Required on BOTH a QR switch and unmount: a
 * surviving timer would otherwise fire `refreshPreview` against whichever QR
 * happens to be selected by then (overwriting the snap-to render below), or
 * write to the refs of an already-unmounted component.
 */
function cancelScheduledRender(): void {
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
  }
}

onUnmounted(cancelScheduledRender);

// Selecting a different QR card resets this panel's session-local upload
// state (see header comment) and snaps the preview straight to the
// newly-selected QR's current render — no stale debounce/preview carries
// across a selection change.
watch(
  () => props.qr.id,
  () => {
    cancelScheduledRender();
    logoFileName.value = null;
    hasCustomLogo.value = false;
    logoError.value = null;
    previewSrc.value = qrRenderPngUrl(props.qr.id);
    isPreviewLoading.value = false;
  },
);

/**
 * Monotonic token for style mutations. Every control change fires its own
 * independent PATCH with no ordering guarantee, so two quick edits can race:
 * if the FIRST response lands second, emitting it would push a DTO the user
 * has already moved past into the parent's list, leaving the list (and the
 * swatch selection) showing a value that is no longer persisted. Only the
 * newest issued request may emit or revert.
 */
let mutationSeq = 0;

/**
 * Issues one style PATCH under the sequence guard above. Returns the server
 * DTO, or `null` when a newer mutation superseded this one — in which case
 * the caller must neither emit nor revert. A failure of a SUPERSEDED request
 * is swallowed for the same reason: reverting to its stale `prev` would undo
 * an edit the user made afterwards.
 */
async function persistStyle(patch: UpdateQrCodeInput): Promise<QrCodeDTO | null> {
  const seq = ++mutationSeq;
  let updated: QrCodeDTO;
  try {
    updated = await updateQrCode(props.qr.id, patch);
  } catch (err) {
    if (seq !== mutationSeq) return null;
    throw err;
  }
  if (seq !== mutationSeq) return null;
  emit("styled", updated);
  scheduleRender();
  return updated;
}

/**
 * Fires on the name input's blur/Enter (not per-keystroke, unlike the
 * color swatches — a text field shouldn't PATCH on every keypress). Blank
 * input is rejected client-side (mirrors the server's non-empty name
 * requirement) and reverts to the last persisted value rather than
 * silently keeping an invalid local edit.
 */
async function commitName(): Promise<void> {
  const trimmed = local.name.trim();
  if (!trimmed) {
    local.name = props.qr.name;
    return;
  }
  if (trimmed === props.qr.name) {
    local.name = trimmed;
    return;
  }
  const prev = props.qr.name;
  local.name = trimmed;
  try {
    await persistStyle({ name: trimmed });
  } catch {
    local.name = prev;
    emit("toast", SAVE_FAILED_MESSAGE);
  }
}

async function setColor(color: string): Promise<void> {
  if (local.color === color) return;
  const prev = local.color;
  local.color = color;
  try {
    await persistStyle({ color });
  } catch {
    local.color = prev;
    emit("toast", SAVE_FAILED_MESSAGE);
  }
}

async function toggleRounded(): Promise<void> {
  const prev = local.roundedModules;
  const next = !prev;
  local.roundedModules = next;
  try {
    await persistStyle({ roundedModules: next });
  } catch {
    local.roundedModules = prev;
    emit("toast", SAVE_FAILED_MESSAGE);
  }
}

async function toggleLogo(): Promise<void> {
  const prev = local.logoEnabled;
  const next = !prev;
  local.logoEnabled = next;
  try {
    await persistStyle({ logoEnabled: next });
  } catch {
    local.logoEnabled = prev;
    emit("toast", SAVE_FAILED_MESSAGE);
  }
}

function triggerFilePicker(): void {
  fileInput.value?.click();
}

/** Fast client-side check (UX only) — the server independently re-validates via magic-byte sniffing (T-07-LOGO-MIME, normalizeLogo). */
function validateLogoFile(file: File): string | null {
  if (file.size > MAX_LOGO_BYTES) return LOGO_SIZE_ERROR;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const isPng = file.type === "image/png" || ext === "png";
  const isSvg = file.type === "image/svg+xml" || ext === "svg";
  if (!isPng && !isSvg) return LOGO_FORMAT_ERROR;
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleLogoFile(file: File): Promise<void> {
  const validationError = validateLogoFile(file);
  if (validationError) {
    logoError.value = validationError;
    return;
  }
  logoError.value = null;

  // `readAsDataUrl` rejects on `reader.onerror`, and this function is
  // invoked as `void handleLogoFile(file)` — so an unguarded await here
  // escapes as an unhandled promise rejection and the user sees nothing
  // (no inline error, no toast). Fail visibly instead.
  let dataUrl: string;
  try {
    dataUrl = await readAsDataUrl(file);
  } catch {
    logoError.value = LOGO_FORMAT_ERROR;
    return;
  }

  try {
    // Upload auto-enables the toggle (07-UI-SPEC.md Copywriting Contract).
    const updated = await persistStyle({ logoData: dataUrl, logoEnabled: true });
    if (!updated) return; // superseded by a newer mutation
    local.logoEnabled = true;
    logoFileName.value = file.name;
    hasCustomLogo.value = true;
  } catch (err) {
    logoError.value = mapQrFormError(err).logoError ?? SAVE_FAILED_MESSAGE;
  }
}

function handleFileInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) void handleLogoFile(file);
  target.value = "";
}

async function removeLogo(): Promise<void> {
  try {
    // Clear BOTH fields, mirroring the upload path's symmetry. Sending only
    // `logoData: null` left `logoEnabled` true, so the server kept forcing
    // error-correction level H for a logo it no longer had, and the
    // decorative placeholder tile reappeared over a preview/export that
    // contains no logo at all.
    const updated = await persistStyle({ logoData: null, logoEnabled: false });
    if (!updated) return; // superseded by a newer mutation
    local.logoEnabled = false;
    logoFileName.value = null;
    hasCustomLogo.value = false;
  } catch {
    emit("toast", SAVE_FAILED_MESSAGE);
  }
}

function requestDelete(): void {
  showDeleteDialog.value = true;
}

function cancelDelete(): void {
  showDeleteDialog.value = false;
}

async function confirmDelete(): Promise<void> {
  try {
    await deleteQrCode(props.qr.id);
    showDeleteDialog.value = false;
    emit("deleted", props.qr.id);
    emit("toast", DELETE_SUCCESS_MESSAGE);
  } catch {
    emit("toast", DELETE_FAILED_MESSAGE);
  }
}

async function exportFile(format: "png" | "svg"): Promise<void> {
  try {
    const blob = await fetchQrRenderBlob(props.qr.id, format);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${props.qr.name || "qr-code"}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    emit("toast", EXPORT_FAILED_MESSAGE);
  }
}
</script>

<template>
  <div class="studio-panel">
    <div class="studio-header">
      <h2 class="studio-title">QR-Studio</h2>
      <span class="studio-code">{{ studioCode }}</span>
      <button type="button" class="studio-delete-button" @click="requestDelete">🗑</button>
    </div>

    <input
      class="name-input"
      type="text"
      v-model="local.name"
      @blur="commitName"
      @keyup.enter="($event.target as HTMLInputElement).blur()"
    />

    <div class="preview-frame">
      <div class="preview-card">
        <img class="preview-image" :class="{ 'is-loading': isPreviewLoading }" :src="previewSrc" alt="" />
        <div v-if="showLogoOverlay" class="logo-overlay">
          <div class="logo-tile">{{ BRAND_INITIAL }}</div>
        </div>
      </div>
    </div>

    <div class="controls">
      <div class="control-row">
        <span class="control-label">Farbe</span>
        <div class="swatch-row">
          <button
            v-for="color in PRODUCT_COLORS"
            :key="color"
            type="button"
            class="color-swatch"
            :class="{ selected: local.color === color }"
            :style="{ background: color }"
            @click="setColor(color)"
          ></button>
        </div>
      </div>

      <div class="control-row">
        <span class="control-label">Logo in der Mitte</span>
        <div
          class="toggle logo-toggle"
          :class="{ active: local.logoEnabled }"
          role="switch"
          :aria-checked="local.logoEnabled"
          @click="toggleLogo"
        >
          <div class="toggle-knob"></div>
        </div>
      </div>

      <div class="control-row">
        <span class="control-label">Runde Module</span>
        <div
          class="toggle rounded-toggle"
          :class="{ active: local.roundedModules }"
          role="switch"
          :aria-checked="local.roundedModules"
          @click="toggleRounded"
        >
          <div class="toggle-knob"></div>
        </div>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/svg+xml"
        class="hidden-file-input"
        @change="handleFileInputChange"
      />

      <div v-if="!logoFileName" class="logo-dropzone" @click="triggerFilePicker">
        Eigenes Logo hochladen (PNG/SVG)
      </div>
      <div v-else class="file-chip">
        <span class="file-chip-name">{{ logoFileName }}</span>
        <span class="file-chip-remove" @click="removeLogo">Logo entfernen</span>
      </div>
      <p v-if="logoError" class="logo-error">{{ logoError }}</p>
    </div>

    <div class="export-row">
      <button type="button" class="export-button export-png" @click="exportFile('png')">PNG ⬇</button>
      <button type="button" class="export-button export-svg" @click="exportFile('svg')">SVG ⬇</button>
    </div>
  </div>

  <div v-if="showDeleteDialog" class="delete-dialog-overlay" @click="cancelDelete">
    <div class="delete-dialog" @click.stop>
      <h3 class="delete-title">QR-Code löschen?</h3>
      <p class="delete-body">
        {{ studioCode || props.qr.name }} wird gelöscht. Bestehende Aufrufe dieses QR-Codes leiten
        danach nicht mehr weiter.
      </p>
      <div class="delete-footer">
        <button type="button" class="cancel-button" @click="cancelDelete">Abbrechen</button>
        <button type="button" class="delete-confirm-button" @click="confirmDelete">Löschen</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

/* Delete action (WR-07) — mirrors LinkDetailView.vue's .action-button.delete hover treatment. */
.studio-delete-button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--mut);
  font-size: 12.5px;
  padding: 4px 8px;
  cursor: pointer;
}

.studio-delete-button:hover {
  border-color: #e5484d;
  color: #e5484d;
  background: var(--panel);
}

/* Delete confirmation dialog (reused shell, mirrors LinkDetailView.vue's dialog verbatim). */
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

.name-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}

.name-input:focus {
  outline: none;
  border-color: var(--accent);
}

.preview-frame {
  display: flex;
  justify-content: center;
  padding: 18px;
  background: var(--bg);
  border-radius: 12px;
}

.preview-card {
  position: relative;
  background: #fff;
  border-radius: 10px;
  padding: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.preview-image {
  width: 196px;
  height: 196px;
  display: block;
  object-fit: contain;
  transition: opacity 0.15s ease;
}

.preview-image.is-loading {
  opacity: 0.6;
}

.logo-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-tile {
  width: 46px;
  height: 46px;
  border-radius: 10px;
  border: 3px solid #fff;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 19px;
  color: #1b1b18;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.control-label {
  font-size: 12.5px;
  color: var(--mut);
}

.swatch-row {
  display: flex;
  gap: 6px;
}

.color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 2px solid var(--border);
  cursor: pointer;
  padding: 0;
}

.color-swatch.selected {
  border-color: var(--accent);
}

/* Toggle shape (identical to LinkFormModal.vue's forwardQuery/tracking toggles — 38x21 pill, 16x16 knob). */
.toggle {
  width: 38px;
  height: 21px;
  border-radius: 999px;
  background: var(--border);
  position: relative;
  cursor: pointer;
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
  transition: left 0.15s ease;
}

.toggle.active .toggle-knob {
  left: 19px;
}

.hidden-file-input {
  display: none;
}

.logo-dropzone {
  border: 1px dashed var(--border);
  border-radius: 9px;
  padding: 10px 12px;
  font-size: 11.5px;
  color: var(--mut);
  text-align: center;
  cursor: pointer;
}

.logo-dropzone:hover {
  border-color: var(--mut);
  color: var(--text);
}

.file-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.file-chip-name {
  font-family: "Geist Mono", monospace;
  font-size: 12.5px;
  color: var(--text);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-chip-remove {
  font-size: 12px;
  color: var(--mut);
  cursor: pointer;
}

.file-chip-remove:hover {
  color: var(--text);
}

.logo-error {
  font-size: 11.5px;
  color: #e5484d;
  margin-top: 4px;
}

.export-row {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.export-button {
  flex: 1;
  padding: 9px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.export-button:hover {
  background: var(--hover);
}
</style>
