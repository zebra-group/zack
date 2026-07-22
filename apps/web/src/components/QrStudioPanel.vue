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
import { computed, ref, watch } from "vue";
import type { QrCodeDTO } from "@kurzly/shared";
import { fetchQrRenderBlob, mapQrFormError, qrRenderPngUrl, updateQrCode } from "../api";

type QrStudioPanelProps = {
  qr: QrCodeDTO;
};

const props = defineProps<QrStudioPanelProps>();

const emit = defineEmits<{
  /** Fired after every successful style/logo mutation so QrCodesView.vue can sync its list + bust the matching thumbnail's cache. */
  styled: [updated: QrCodeDTO];
  toast: [message: string];
}>();

/** LOCKED product QR-module colors (07-UI-SPEC.md) — an independent product color system, never `--accent`. */
const PRODUCT_COLORS = ["#17170f", "#1e3a5f", "#14532d", "#7c2d4f"];

const BRAND_INITIAL = "K";

const SAVE_FAILED_MESSAGE = "Speichern fehlgeschlagen. Bitte erneut versuchen.";
const LOGO_FORMAT_ERROR = "Nur PNG oder SVG erlaubt.";
const LOGO_SIZE_ERROR = "Datei zu groß (max. 1,4 MB).";
const EXPORT_FAILED_MESSAGE = "Export fehlgeschlagen. Bitte erneut versuchen.";
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

const studioCode = computed(() => (props.qr.variant === "dynamic" ? `/q/${props.qr.code}` : ""));
const showLogoOverlay = computed(() => props.qr.logoEnabled && !hasCustomLogo.value);

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
  if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
  renderDebounceTimer = setTimeout(refreshPreview, RENDER_DEBOUNCE_MS);
}

// Selecting a different QR card resets this panel's session-local upload
// state (see header comment) and snaps the preview straight to the
// newly-selected QR's current render — no stale debounce/preview carries
// across a selection change.
watch(
  () => props.qr.id,
  () => {
    logoFileName.value = null;
    hasCustomLogo.value = false;
    logoError.value = null;
    previewSrc.value = qrRenderPngUrl(props.qr.id);
    isPreviewLoading.value = false;
  },
);

async function setColor(color: string): Promise<void> {
  if (props.qr.color === color) return;
  const prev = props.qr.color;
  props.qr.color = color;
  try {
    const updated = await updateQrCode(props.qr.id, { color });
    emit("styled", updated);
    scheduleRender();
  } catch {
    props.qr.color = prev;
    emit("toast", SAVE_FAILED_MESSAGE);
  }
}

async function toggleRounded(): Promise<void> {
  const prev = props.qr.roundedModules;
  props.qr.roundedModules = !prev;
  try {
    const updated = await updateQrCode(props.qr.id, { roundedModules: props.qr.roundedModules });
    emit("styled", updated);
    scheduleRender();
  } catch {
    props.qr.roundedModules = prev;
    emit("toast", SAVE_FAILED_MESSAGE);
  }
}

async function toggleLogo(): Promise<void> {
  const prev = props.qr.logoEnabled;
  props.qr.logoEnabled = !prev;
  try {
    const updated = await updateQrCode(props.qr.id, { logoEnabled: props.qr.logoEnabled });
    emit("styled", updated);
    scheduleRender();
  } catch {
    props.qr.logoEnabled = prev;
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

  const dataUrl = await readAsDataUrl(file);
  try {
    // Upload auto-enables the toggle (07-UI-SPEC.md Copywriting Contract).
    const updated = await updateQrCode(props.qr.id, { logoData: dataUrl, logoEnabled: true });
    props.qr.logoEnabled = true;
    logoFileName.value = file.name;
    hasCustomLogo.value = true;
    emit("styled", updated);
    scheduleRender();
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
    const updated = await updateQrCode(props.qr.id, { logoData: null });
    logoFileName.value = null;
    hasCustomLogo.value = false;
    emit("styled", updated);
    scheduleRender();
  } catch {
    emit("toast", SAVE_FAILED_MESSAGE);
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
    </div>

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
            :class="{ selected: qr.color === color }"
            :style="{ background: color }"
            @click="setColor(color)"
          ></button>
        </div>
      </div>

      <div class="control-row">
        <span class="control-label">Logo in der Mitte</span>
        <div
          class="toggle logo-toggle"
          :class="{ active: qr.logoEnabled }"
          role="switch"
          :aria-checked="qr.logoEnabled"
          @click="toggleLogo"
        >
          <div class="toggle-knob"></div>
        </div>
      </div>

      <div class="control-row">
        <span class="control-label">Runde Module</span>
        <div
          class="toggle rounded-toggle"
          :class="{ active: qr.roundedModules }"
          role="switch"
          :aria-checked="qr.roundedModules"
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
