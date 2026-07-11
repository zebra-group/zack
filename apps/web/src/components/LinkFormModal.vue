<script setup lang="ts">
/**
 * Shared Neuer-Link/Bearbeiten modal (04-UI-SPEC.md Neuer-Link-/
 * Bearbeiten-Modal, LINK-02/LINK-06, D-04). Owns its own form fields
 * (fresh instance per open, mirrors DomainsView's per-open state
 * pattern); the parent (LinksView/LinkDetailView) owns the actual
 * createLink/updateLink call and passes back the last `ApiError` via the
 * `error` prop, mapped to inline field errors via `../api.ts`'s
 * `mapLinkFormError` (kept there, not here, because the generic `*.vue`
 * module shim only declares a `default` export — see that function's
 * doc comment).
 *
 * The D-04 slug-change warning is PERSISTENT in edit mode — shown
 * whenever `mode === "edit"`, not only on an actual change, so it can
 * never be scrolled past unnoticed.
 */
import { computed, ref } from "vue";
import type { DomainDTO } from "@kurzly/shared";
import { mapLinkFormError } from "../api";

const props = defineProps<{
  mode: "create" | "edit";
  /** Active + accessible domains for the create-mode Select (D-03-filtered by the caller). */
  domains: DomainDTO[];
  /** Read-only domain chip shown in edit mode (domain is not editable, Claude's Discretion per UI-SPEC). */
  domainHostname?: string;
  initialTargetUrl?: string;
  initialSlug?: string;
  initialDomainId?: string;
  /** Last submit error from the parent, mapped to inline field errors. */
  error?: unknown;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: { domainId?: string; targetUrl: string; slug?: string }];
}>();

const targetUrl = ref(props.initialTargetUrl ?? "");
const slug = ref(props.initialSlug ?? "");
const domainId = ref(props.initialDomainId ?? props.domains[0]?.id ?? "");

const fieldErrors = computed(() => mapLinkFormError(props.error));

function handleSubmit(): void {
  emit("submit", {
    domainId: props.mode === "create" ? domainId.value : undefined,
    targetUrl: targetUrl.value,
    slug: slug.value.trim() ? slug.value.trim() : undefined,
  });
}
</script>

<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="modal-dialog" @click.stop>
      <div class="modal-header">
        <h3 class="modal-title">{{ mode === "create" ? "Neuer Link" : "Link bearbeiten" }}</h3>
        <span class="modal-close" @click="emit('close')">✕</span>
      </div>

      <div class="field">
        <label class="field-label">Ziel-URL</label>
        <input
          v-model="targetUrl"
          type="text"
          class="field-input mono"
          placeholder="https://example.com/sehr/lange/url"
        />
        <p v-if="fieldErrors.targetUrlError" class="field-error">{{ fieldErrors.targetUrlError }}</p>
      </div>

      <div class="field-row">
        <div class="field domain-field">
          <label class="field-label">Domain</label>
          <select v-if="mode === 'create'" v-model="domainId" class="field-input mono">
            <option v-for="d in domains" :key="d.id" :value="d.id">{{ d.hostname }}</option>
          </select>
          <div v-else class="domain-chip">{{ domainHostname }}</div>
        </div>
        <span class="field-sep">/</span>
        <div class="field slug-field">
          <label class="field-label">Slug</label>
          <input
            v-model="slug"
            type="text"
            class="field-input mono"
            :placeholder="mode === 'create' ? 'leer lassen = automatisch' : undefined"
          />
          <p v-if="fieldErrors.slugError" class="field-error">{{ fieldErrors.slugError }}</p>
        </div>
      </div>

      <div v-if="mode === 'edit'" class="slug-warning">
        <div class="slug-warning-icon">⚠</div>
        <div class="slug-warning-text">
          <div class="slug-warning-title">Achtung: Slug-Änderung</div>
          <div class="slug-warning-body">
            Diese Änderung ändert die Kurz-URL. Bestehende geteilte Links (und später QR-Codes)
            verweisen weiterhin auf `{{ initialSlug }}` und funktionieren danach nicht mehr.
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" @click="emit('close')">Abbrechen</button>
        <button type="button" class="btn-primary" @click="handleSubmit">
          {{ mode === "create" ? "Link erstellen" : "Speichern" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Overlay + dialog shell (04-UI-SPEC.md Neuer-Link-/Bearbeiten-Modal, LOCKED width/padding/radius). */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 44px 20px;
  z-index: 50;
}

.modal-dialog {
  width: 620px;
  max-width: 100%;
  max-height: 100%;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.modal-close {
  cursor: pointer;
  color: var(--mut);
}

.modal-close:hover {
  color: var(--text);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--mut);
}

.field-input {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}

.field-input.mono {
  font-family: "Geist Mono", monospace;
}

.field-error {
  font-size: 11.5px;
  color: #e5484d;
  margin: -2px 0 0;
}

.field-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.domain-field {
  flex: 1;
}

.slug-field {
  flex: 1;
}

.domain-chip {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--chip);
  color: var(--mut);
  font-size: 13px;
  font-family: "Geist Mono", monospace;
}

.field-sep {
  padding-bottom: 10px;
  color: var(--mut);
}

/* D-04 persistent slug-change warning. */
.slug-warning {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #e5484d;
  /* --danger-tint (04-UI-SPEC.md Color section): light 0.08 / dark 0.12 —
     scoped literal rgba(), not a global custom property (per spec). */
  background: rgba(229, 72, 77, 0.08);
}

:global(body[data-theme="dark"]) .slug-warning {
  background: rgba(229, 72, 77, 0.12);
}

.slug-warning-icon {
  font-size: 14px;
  width: 28px;
  height: 28px;
  background: var(--chip);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.slug-warning-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #e5484d;
}

.slug-warning-body {
  font-size: 12px;
  color: var(--mut);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
</style>
