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
 *
 * Phase 5 (D-01/D-02/D-03/D-12, 05-UI-SPEC.md § Link-Formular-Erweiterung):
 * adds the Security accordion (password + date-only expiry) and the
 * forwardQuery toggle. The password input is NEVER pre-filled — even in
 * edit mode with an existing password — the DTO only ever carries the
 * derived `passwordProtected` boolean (T-05-PWPREFILL); a placeholder
 * communicates the "set" state instead. A blank/untouched password field
 * on submit means KEEP (`undefined`); only the explicit "Passwortschutz
 * entfernen" action emits `null` to CLEAR (T-05-KEEPCLEAR).
 */
import { computed, ref } from "vue";
import type { DomainDTO } from "@kurzly/shared";
import { mapLinkFormError } from "../api";

type LinkFormModalProps = {
  mode: "create" | "edit";
  /** Active + accessible domains for the create-mode Select (D-03-filtered by the caller). */
  domains: DomainDTO[];
  /** Read-only domain chip shown in edit mode (domain is not editable, Claude's Discretion per UI-SPEC). */
  domainHostname?: string;
  initialTargetUrl?: string;
  initialSlug?: string;
  initialDomainId?: string;
  /** Phase 5: whether the link currently has a password set (never the password itself). */
  initialPasswordProtected?: boolean;
  /** Phase 5: `YYYY-MM-DD`, or `null`/`undefined` if the link never expires. */
  initialExpiresAt?: string | null;
  /** Phase 5: whether incoming query params are currently forwarded to the target. */
  initialForwardQuery?: boolean;
  /**
   * Phase 6 (TRACK-01/D-15): whether internal click tracking is currently
   * enabled for this link. Create mode always defaults ON (the caller
   * simply omits this prop, and `withDefaults` below fills it with
   * `true` — a plain `props.initialTrackingEnabled ?? true` would NOT
   * work here since Vue's single-Boolean-type prop casting resolves an
   * absent prop to `false`, not `undefined`); edit mode pre-fills it from
   * `link.trackingEnabled`.
   */
  initialTrackingEnabled?: boolean;
  /** Last submit error from the parent, mapped to inline field errors. */
  error?: unknown;
};

const props = withDefaults(defineProps<LinkFormModalProps>(), {
  initialTrackingEnabled: true,
});

const emit = defineEmits<{
  close: [];
  submit: [
    payload: {
      domainId?: string;
      targetUrl: string;
      slug?: string;
      password?: string | null;
      expiresAt?: string | null;
      forwardQuery: boolean;
      trackingEnabled: boolean;
    },
  ];
}>();

const targetUrl = ref(props.initialTargetUrl ?? "");
const slug = ref(props.initialSlug ?? "");
const domainId = ref(props.initialDomainId ?? props.domains[0]?.id ?? "");

// Phase 5 Security accordion + forwardQuery toggle state — collapsed by
// default (05-UI-SPEC.md: "Standard: eingeklappt"). `password` always
// starts blank, even in edit mode with an existing password
// (T-05-PWPREFILL) — the placeholder communicates the "set" state.
const secOpen = ref(false);
const password = ref("");
const removePassword = ref(false);
const expiry = ref(props.initialExpiresAt ?? "");
const forwardQuery = ref(props.initialForwardQuery ?? false);

// Phase 6 footer tracking toggle (TRACK-01/D-15, Surface C1) — create mode
// defaults ON via the withDefaults(...) declaration above (the caller
// omits this prop in create mode), edit mode pre-fills from
// link.trackingEnabled.
const trackingEnabled = ref(props.initialTrackingEnabled);

const fieldErrors = computed(() => mapLinkFormError(props.error));

/** True while the "set" placeholder + "Passwortschutz entfernen" link should show. */
const hasExistingPassword = computed(
  () => props.mode === "edit" && !!props.initialPasswordProtected && !removePassword.value,
);

const passwordPlaceholder = computed(() =>
  hasExistingPassword.value ? "•••• gesetzt — leer lassen, um beizubehalten" : "optional",
);

/** Whether the accordion header's summary suffix should mention a password. */
const passwordWillBeSet = computed(() => {
  if (removePassword.value) return false;
  if (password.value.trim()) return true;
  return props.mode === "edit" && !!props.initialPasswordProtected;
});

/** `YYYY-MM-DD` -> `DD.MM.YYYY` — pure string split, no `Date` parsing (avoids TZ off-by-one). */
function formatSummaryDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}

const accordionSummary = computed(() => {
  const parts: string[] = [];
  if (passwordWillBeSet.value) parts.push("Passwort gesetzt");
  if (expiry.value) parts.push(`läuft am ${formatSummaryDate(expiry.value)} ab`);
  return parts.length ? `· ${parts.join(" · ")}` : "";
});

function handleSubmit(): void {
  const passwordPayload = removePassword.value ? null : password.value ? password.value : undefined;
  const expiresAtPayload = expiry.value ? expiry.value : props.initialExpiresAt ? null : undefined;

  emit("submit", {
    domainId: props.mode === "create" ? domainId.value : undefined,
    targetUrl: targetUrl.value,
    slug: slug.value.trim() ? slug.value.trim() : undefined,
    password: passwordPayload,
    expiresAt: expiresAtPayload,
    forwardQuery: forwardQuery.value,
    trackingEnabled: trackingEnabled.value,
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

      <!-- Phase 5 Security accordion (05-UI-SPEC.md § Link-Formular-Erweiterung). -->
      <div class="security-section">
        <div class="security-header" @click="secOpen = !secOpen">
          <span>
            Passwort &amp; Ablauf<span v-if="accordionSummary" class="security-summary">
              {{ accordionSummary }}</span
            >
          </span>
          <span class="security-chevron">{{ secOpen ? "⌃" : "⌄" }}</span>
        </div>
        <div v-if="secOpen" class="security-body">
          <div class="field">
            <label class="field-label">Passwortschutz</label>
            <input
              v-model="password"
              type="password"
              class="field-input"
              :placeholder="passwordPlaceholder"
            />
            <a
              v-if="hasExistingPassword"
              href="#"
              class="remove-pw-link"
              @click.prevent="removePassword = true"
              >Passwortschutz entfernen</a
            >
          </div>
          <div class="field">
            <label class="field-label">Ablaufdatum</label>
            <input v-model="expiry" type="date" class="field-input" />
            <p class="helper-text">Der Link läuft am Ende des gewählten Tages ab.</p>
          </div>
        </div>
      </div>

      <!-- Phase 5 forwardQuery toggle (05-UI-SPEC.md, D-12/D-13). -->
      <div class="forward-query-row">
        <div class="toggle-label-group">
          <span class="toggle-label">Query-Parameter an Ziel-URL weitergeben</span>
          <span class="toggle-helper"
            >Eingehende Parameter werden ergänzt; in der Ziel-URL gespeicherte Parameter bleiben
            unverändert.</span
          >
        </div>
        <div
          class="toggle"
          :class="{ active: forwardQuery }"
          role="switch"
          :aria-checked="forwardQuery"
          @click="forwardQuery = !forwardQuery"
        >
          <div class="toggle-knob"></div>
        </div>
      </div>

      <!-- Phase 6 footer tracking toggle (06-UI-SPEC.md § C1, TRACK-01/D-15,
           default AN). Identical toggle shape/pattern to the forwardQuery
           toggle above (Phase 6 builds the original prototype tracking
           toggle Phase 5 was itself pattern-derived from) — NO helper text
           here, unlike forwardQuery. -->
      <div class="modal-footer">
        <div class="tracking-toggle-group">
          <div
            class="toggle"
            :class="{ active: trackingEnabled }"
            role="switch"
            :aria-checked="trackingEnabled"
            @click="trackingEnabled = !trackingEnabled"
          >
            <div class="toggle-knob"></div>
          </div>
          <span class="toggle-label">Internes Tracking</span>
        </div>
        <div class="footer-buttons">
          <button type="button" class="btn-secondary" @click="emit('close')">Abbrechen</button>
          <button type="button" class="btn-primary" @click="handleSubmit">
            {{ mode === "create" ? "Link erstellen" : "Speichern" }}
          </button>
        </div>
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

/* Phase 5 Security accordion (05-UI-SPEC.md, LOCKED tokens). */
.security-section {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.security-header {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.security-header:hover {
  background: var(--hover);
}

.security-summary {
  font-size: 13px;
  font-weight: 400;
  color: var(--mut);
}

.security-chevron {
  color: var(--mut);
}

.security-body {
  padding: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  border-top: 1px solid var(--border);
}

.remove-pw-link {
  font-size: 12px;
  color: var(--mut);
  text-decoration: none;
  width: fit-content;
}

.remove-pw-link:hover {
  color: var(--text);
}

.helper-text {
  font-size: 11px;
  color: var(--mut);
  margin: 0;
}

/* Phase 5 forwardQuery toggle (05-UI-SPEC.md, pattern-derived from prototype's tracking toggle). */
.forward-query-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 2px;
}

.toggle-label-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-label {
  font-size: 12.5px;
  color: var(--text);
}

.toggle-helper {
  font-size: 11px;
  color: var(--mut);
}

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

/* Phase 6 footer tracking toggle (06-UI-SPEC.md § C1) — footer switches
   from flex-end (buttons only) to space-between (toggle group left,
   buttons right). The .toggle/.toggle-knob classes above are reused
   verbatim (identical 38x21/16x16 shape, same active-accent/inactive-
   border tokens) — no new toggle CSS invented here. */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 2px;
}

.tracking-toggle-group {
  display: flex;
  align-items: center;
  gap: 9px;
}

.tracking-toggle-group .toggle-label {
  /* Override the forwardQuery .toggle-label's --text color — the tracking
     toggle label is --mut (06-UI-SPEC.md § C1), no helper text alongside it. */
  color: var(--mut);
}

.footer-buttons {
  display: flex;
  gap: 8px;
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
