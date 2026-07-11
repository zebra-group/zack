<script setup lang="ts">
/**
 * CSV bulk-import screen (04-UI-SPEC.md CSV-Bulk-Import-Screen, LINK-08,
 * D-05, UI-06) — route /links/import, its own screen (not a modal, per
 * UI-SPEC's Begründung). Reads the selected file client-side via
 * FileReader.readAsText, then sends the raw CSV text to
 * previewImport/commitImport — the preview list renders ONLY the
 * backend-computed ImportPreviewResult (T-04-PREVIEWDRIFT); this view
 * never parses or re-validates the CSV itself.
 *
 * Toast pattern: per-view ref + setTimeout (04-PATTERNS.md), no global
 * store. Commit navigates away on success — the toast is shown first and
 * navigation deliberately delayed slightly so the user sees it before
 * the route change (same pattern as LinkDetailView's delete flow).
 */
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { DomainDTO, ImportPreviewResult, LinkSkipReason } from "@kurzly/shared";
import { commitImport, listDomains, previewImport } from "../api";

const router = useRouter();

const SAMPLE_CSV = `ziel_url,slug,domain
https://example.com/willkommen,willkommen,
https://example.com/hilfe,hilfe,
`;

const SKIP_REASON_LABELS: Record<LinkSkipReason, string> = {
  invalid_url: "Ungültige Ziel-URL",
  slug_conflict: "Slug bereits vergeben oder reserviert",
  domain_unauthorized: "Domain nicht autorisiert oder unbekannt",
  duplicate_in_file: "Duplikat innerhalb der Datei",
};

const domains = ref<DomainDTO[]>([]);
const defaultDomainId = ref<string>("");
const fileName = ref<string | null>(null);
const csvText = ref<string>("");
const preview = ref<ImportPreviewResult | null>(null);
const isCommitting = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

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

async function loadDomains(): Promise<void> {
  try {
    domains.value = await listDomains();
  } catch {
    showToast("Domains konnten nicht geladen werden.");
  }
}

function skipReasonLabel(reason: LinkSkipReason | null): string {
  if (!reason) return "";
  return SKIP_REASON_LABELS[reason];
}

function triggerFilePicker(): void {
  fileInput.value?.click();
}

function readFile(file: File): void {
  fileName.value = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    csvText.value = typeof reader.result === "string" ? reader.result : "";
    loadPreview();
  };
  reader.readAsText(file);
}

function handleFileInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) readFile(file);
}

function handleDrop(event: DragEvent): void {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) readFile(file);
}

function loadSample(): void {
  fileName.value = "beispiel.csv";
  csvText.value = SAMPLE_CSV;
  loadPreview();
}

function changeFile(): void {
  fileName.value = null;
  csvText.value = "";
  preview.value = null;
  triggerFilePicker();
}

async function loadPreview(): Promise<void> {
  if (!csvText.value) return;
  try {
    preview.value = await previewImport(csvText.value, defaultDomainId.value || undefined);
  } catch {
    showToast("Vorschau konnte nicht geladen werden.");
  }
}

// Re-run the (server-driven) preview when the default domain changes and
// a file is already loaded — the default domain affects rows whose CSV
// `domain` column is blank.
watch(defaultDomainId, () => {
  if (csvText.value) loadPreview();
});

async function handleCommit(): Promise<void> {
  if (!preview.value || preview.value.validCount === 0 || isCommitting.value) return;
  isCommitting.value = true;
  try {
    const result = await commitImport(csvText.value, defaultDomainId.value || undefined);
    showToast(`${result.importedCount} Links importiert`);
    setTimeout(() => {
      router.push({ name: "links" });
    }, 900);
  } catch {
    showToast("Import fehlgeschlagen.");
  } finally {
    isCommitting.value = false;
  }
}

function goBack(): void {
  router.push({ name: "links" });
}

loadDomains();
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>Links importieren</h1>
      <div class="spacer"></div>
      <button type="button" class="back-link" @click="goBack">← Alle Links</button>
    </div>

    <div class="import-panel">
      <p class="format-hint">
        CSV-Datei hochladen. Spalten:
        <code>ziel_url, slug, domain</code>
        (Slug &amp; Domain optional).
      </p>

      <div class="default-domain-row">
        <div class="select-block">
          <label class="field-label">Domain für Zeilen ohne eigene Angabe</label>
          <select v-model="defaultDomainId" class="field-input mono">
            <option value="">— keine —</option>
            <option v-for="d in activeDomains" :key="d.id" :value="d.id">{{ d.hostname }}</option>
          </select>
        </div>
        <button type="button" class="sample-link" @click="loadSample">Beispieldatei laden</button>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept=".csv"
        class="hidden-file-input"
        @change="handleFileInputChange"
      />

      <div
        v-if="!fileName"
        class="dropzone"
        @click="triggerFilePicker"
        @dragover.prevent
        @drop="handleDrop"
      >
        <div class="dropzone-icon">📄</div>
        <div class="dropzone-label">
          CSV-Datei hierher ziehen oder
          <span class="dropzone-trigger">Datei auswählen</span>
        </div>
        <div class="dropzone-hint">.csv · UTF-8</div>
      </div>

      <div v-else class="file-chip">
        <span class="file-chip-name">{{ fileName }}</span>
        <span class="file-chip-change" @click="changeFile">Datei ändern</span>
      </div>

      <div v-if="preview" class="preview">
        <div class="preview-summary">
          <span class="valid-count">{{ preview.validCount }} gültig</span>
          <template v-if="preview.skippedCount > 0">
            <span class="sep">·</span>
            <span class="skipped-count">{{ preview.skippedCount }} übersprungen</span>
          </template>
        </div>

        <div class="preview-list">
          <div
            v-for="(row, idx) in preview.rows"
            :key="idx"
            class="preview-row"
            :class="{ invalid: !row.valid }"
          >
            <span class="preview-slug">/{{ row.slug ?? "" }}</span>
            <span class="preview-target">{{ row.zielUrl ?? "" }}</span>
            <span v-if="!row.valid" class="preview-reason">{{ skipReasonLabel(row.reason) }}</span>
            <span v-else class="preview-reason"></span>
            <span class="preview-icon" :class="row.valid ? 'ok' : 'fail'">{{
              row.valid ? "✓" : "✕"
            }}</span>
          </div>
        </div>
      </div>

      <div class="footer">
        <button type="button" class="btn-secondary" @click="goBack">Abbrechen</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="!preview || preview.validCount === 0"
          @click="handleCommit"
        >
          Importieren ({{ preview?.validCount ?? 0 }})
        </button>
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

.spacer {
  flex: 1;
}

.back-link {
  font-size: 12.5px;
  color: var(--mut);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.back-link:hover {
  color: var(--text);
}

.import-panel {
  max-width: 640px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.format-hint {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

.format-hint code {
  font-family: "Geist Mono", monospace;
  color: var(--text);
}

.default-domain-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--mut);
}

.field-input {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}

.field-input.mono {
  font-family: "Geist Mono", monospace;
}

.sample-link {
  align-self: flex-end;
  padding: 9px 13px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--mut);
  cursor: pointer;
  background: none;
}

.sample-link:hover {
  border-color: var(--mut);
  color: var(--text);
}

.hidden-file-input {
  display: none;
}

.dropzone {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: var(--panel);
  cursor: pointer;
}

.dropzone:hover {
  border-color: var(--mut);
}

.dropzone-icon {
  font-size: 24px;
  margin-bottom: 10px;
}

.dropzone-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.dropzone-trigger {
  text-decoration: underline;
}

.dropzone-hint {
  font-size: 11.5px;
  color: var(--mut);
  margin-top: 4px;
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

.file-chip-change {
  font-size: 12px;
  color: var(--mut);
  cursor: pointer;
}

.file-chip-change:hover {
  color: var(--text);
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}

.valid-count {
  font-weight: 600;
  color: var(--ok);
}

.sep {
  color: var(--mut);
}

.skipped-count {
  color: var(--mut);
}

.preview-list {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  max-height: 220px;
  overflow-y: auto;
}

.preview-row {
  display: grid;
  grid-template-columns: 140px 1fr 170px 20px;
  gap: 10px;
  padding: 8px 12px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
  font-family: "Geist Mono", monospace;
}

.preview-row:last-child {
  border-bottom: none;
}

.preview-slug {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.preview-row.invalid .preview-slug {
  color: var(--mut);
}

.preview-target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mut);
}

.preview-reason {
  font-family: "Geist", sans-serif;
  font-size: 11px;
  color: #e5484d;
}

.preview-icon.ok {
  color: var(--ok);
}

.preview-icon.fail {
  color: #e5484d;
}

.footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 2px;
}

.btn-secondary {
  padding: 9px 15px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--hover);
}

.btn-primary {
  padding: 9px 18px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #1b1b18;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.85;
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
