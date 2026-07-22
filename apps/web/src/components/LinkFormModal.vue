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
import { computed, onUnmounted, ref, watch } from "vue";
import type { DomainDTO } from "@kurzly/shared";
import { mapLinkFormError } from "../api";
import { buildUtmPreview } from "../lib/utm";

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
  /**
   * Phase 8 UTM builder trio (D-08-01/D-08-05, 08-04 Task 3, META-01):
   * pre-fills the Surface A inputs in edit mode. `undefined`/omitted (both
   * in create mode and when the link never had the field set) renders an
   * empty input — the UI-08-05 keep-vs-clear submit logic below treats
   * "started populated" and "never populated" differently.
   */
  initialUtmSource?: string;
  initialUtmMedium?: string;
  initialUtmCampaign?: string;
  /**
   * Phase 8 custom OG trio (D-08-03/D-08-05, 08-05, META-02): pre-fills
   * the Surface B inputs in edit mode. Same `undefined`-vs-empty-string
   * distinction as the UTM trio above drives UI-08-05's keep-vs-clear
   * submit logic below.
   */
  initialOgTitle?: string;
  initialOgDescription?: string;
  initialOgImageUrl?: string;
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
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
      ogTitle?: string | null;
      ogDescription?: string | null;
      ogImageUrl?: string | null;
    },
  ];
}>();

const targetUrl = ref(props.initialTargetUrl ?? "");
const slug = ref(props.initialSlug ?? "");
const domainId = ref(props.initialDomainId ?? props.domains[0]?.id ?? "");

// Phase 8 UTM builder trio (08-04 Task 3, META-01) — pre-filled from the
// initial-value props in edit mode, blank in create mode.
const utmSource = ref(props.initialUtmSource ?? "");
const utmMedium = ref(props.initialUtmMedium ?? "");
const utmCampaign = ref(props.initialUtmCampaign ?? "");

// Phase 8 custom OG trio (08-05 Task 1, META-02) — pre-filled from the
// initial-value props in edit mode, blank in create mode, mirroring the
// UTM trio above.
const ogTitle = ref(props.initialOgTitle ?? "");
const ogDescription = ref(props.initialOgDescription ?? "");
const ogImageUrl = ref(props.initialOgImageUrl ?? "");

// Phase 8 (UI-08-01/04): the Phase-5 single-boolean accordion (`secOpen`)
// generalizes into an exclusive three-section shell shared by the
// password/expiry section ("sec") and the two Phase-8 sections ("utm",
// "og") that slot in above it. At most one section is open at a time;
// clicking the currently-open header's toggle closes it back to `null`.
// All sections start closed, in both create and edit mode, even when the
// edited link has values set (05-UI-SPEC.md's "Standard: eingeklappt",
// carried forward unchanged).
type AccordionSectionId = "utm" | "og" | "sec";
const openSection = ref<AccordionSectionId | null>(null);
function toggleSection(id: AccordionSectionId): void {
  openSection.value = openSection.value === id ? null : id;
}

// `password` always starts blank, even in edit mode with an existing
// password (T-05-PWPREFILL) — the placeholder communicates the "set" state.
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

/** Number of the three UTM fields that currently hold a non-empty value (Copywriting Contract's `n`). */
const utmSetCount = computed(
  () => [utmSource.value, utmMedium.value, utmCampaign.value].filter((v) => v.trim().length > 0).length,
);

/** `· {n} gesetzt`, or empty when nothing is set — identical format to the Phase-5 accordionSummary above. */
const utmSummary = computed(() => (utmSetCount.value > 0 ? `· ${utmSetCount.value} gesetzt` : ""));

/** Number of the three OG fields that currently hold a non-empty value (Copywriting Contract's `n`). */
const ogSetCount = computed(
  () => [ogTitle.value, ogDescription.value, ogImageUrl.value].filter((v) => v.trim().length > 0).length,
);

/** `· {n} gesetzt`, or empty when nothing is set — identical format to utmSummary above. */
const ogSummary = computed(() => (ogSetCount.value > 0 ? `· ${ogSetCount.value} gesetzt` : ""));

/**
 * Surface B social-card domain line (UI-08-06, T-08-CARD-LEAK): derives
 * ONLY from the currently selected short-link domain — the create-mode
 * Select's `domains` prop looked up by `domainId`, or the edit-mode
 * `domainHostname` prop — NEVER from `targetUrl`. Blank (no placeholder
 * text) when nothing is selected yet, matching the Copywriting Contract.
 */
const ogCardDomain = computed(() => {
  if (props.mode === "edit") return props.domainHostname ?? "";
  return props.domains.find((d) => d.id === domainId.value)?.hostname ?? "";
});

/**
 * Surface B image binding gate (T-08-IMG-SCHEME/T-08-IMG-BEACON,
 * 08-UI-SPEC.md's "Bild-Request-Auslöser" Checker-Nachtrag): an absolute
 * http/https URL only — a relative path, `javascript:`, `data:`, or any
 * other scheme never becomes an `<img src>`. `new URL()` throws on
 * anything that doesn't parse as absolute, which doubles as the "still
 * mid-typing" guard (e.g. "h", "https:/").
 */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const OG_IMAGE_DEBOUNCE_MS = 300;

/** The actually-bound `<img src>` — set only after the debounce below confirms an absolute http/https URL. */
const ogDebouncedImageSrc = ref<string | null>(null);
/** Raised by the `<img>`'s `@error` handler; reverts the card to the hatched placeholder (never a broken-image icon). */
const ogImageLoadFailed = ref(false);
let ogImageDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * This is the ONE exception to "every preview updates synchronously"
 * (UI-08-10's Checker-Nachtrag): the `<img src>` binding is debounced and
 * parse-gated so that typing a URL character by character never fires a
 * browser request for every partial host (`h`, `ht`, `https://ex`, …).
 * Every OTHER field in this modal (UTM preview, OG title/description
 * text) still updates per keystroke with no debounce — only this one
 * binding is exempt, and only because it is the sole one that causes the
 * BROWSER (not this app's server, D-08-04/T-08-SSRF-CLIENT) to issue a
 * network request.
 *
 * Phase 8 (08-06, D8 fix): `{ immediate: true }` — 08-05 originally left
 * this change-only, which meant an edit-mode link that already has a
 * valid image URL showed the hatched placeholder until the user edited
 * the field once. Running on mount too closes that gap while keeping the
 * exact same debounce + parse-gate timing (no per-keystroke request, no
 * behavior change for create mode or for a freshly typed value).
 */
watch(
  ogImageUrl,
  (value) => {
    ogImageLoadFailed.value = false;
    ogDebouncedImageSrc.value = null;
    if (ogImageDebounceTimer) clearTimeout(ogImageDebounceTimer);
    ogImageDebounceTimer = setTimeout(() => {
      if (isAbsoluteHttpUrl(value)) ogDebouncedImageSrc.value = value;
    }, OG_IMAGE_DEBOUNCE_MS);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (ogImageDebounceTimer) clearTimeout(ogImageDebounceTimer);
});

function handleOgImageError(): void {
  ogImageLoadFailed.value = true;
}

/**
 * Surface A live preview (UI-08-10): recomputes on every keystroke of the
 * target URL or any of the three UTM fields — no debounce, no network
 * call — via `buildUtmPreview`, the pure client-side mirror of the
 * server's `applyUtmParams` (../lib/utm.ts's doc comment). Stays live even
 * while the section is closed since it reads the same refs the inputs
 * bind to; there is no separate "snapshot on open" state.
 */
const utmPreview = computed(() =>
  buildUtmPreview(targetUrl.value, {
    utmSource: utmSource.value,
    utmMedium: utmMedium.value,
    utmCampaign: utmCampaign.value,
  }),
);

/**
 * UI-08-05 keep-vs-clear for the six Phase 8 fields (this plan's three UTM
 * ones; the OG trio in the next plan follows the identical shape): a
 * non-empty current value is sent as-is, an empty value is sent as an
 * explicit clear (`null`) only when the field started out populated, and
 * is omitted (`undefined`, i.e. "keep") when it never had a value to
 * begin with. Factored into one helper rather than repeated three times —
 * unlike the password field (T-05-KEEPCLEAR), an emptied Phase 8 field
 * always means "delete", never "leave unchanged".
 */
function keepClearOrSet(current: string, initial: string | undefined): string | null | undefined {
  if (current.trim()) return current;
  return initial ? null : undefined;
}

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
    utmSource: keepClearOrSet(utmSource.value, props.initialUtmSource),
    utmMedium: keepClearOrSet(utmMedium.value, props.initialUtmMedium),
    utmCampaign: keepClearOrSet(utmCampaign.value, props.initialUtmCampaign),
    ogTitle: keepClearOrSet(ogTitle.value, props.initialOgTitle),
    ogDescription: keepClearOrSet(ogDescription.value, props.initialOgDescription),
    ogImageUrl: keepClearOrSet(ogImageUrl.value, props.initialOgImageUrl),
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

      <!-- Phase 8 "UTM-Parameter" accordion section (08-UI-SPEC.md Surface A,
           META-01, UI-08-03/10). Sits above the OG section (next plan) and
           Passwort & Ablauf on the shared accordion shell (openSection). -->
      <div class="accordion-section">
        <div
          class="accordion-header accordion-header--utm"
          role="button"
          tabindex="0"
          :aria-expanded="openSection === 'utm'"
          @click="toggleSection('utm')"
          @keydown.enter.prevent="toggleSection('utm')"
          @keydown.space.prevent="toggleSection('utm')"
        >
          <span>
            UTM-Parameter<span v-if="utmSummary" class="accordion-summary"> {{ utmSummary }}</span>
          </span>
          <span class="accordion-chevron">{{ openSection === "utm" ? "⌃" : "⌄" }}</span>
        </div>
        <div v-if="openSection === 'utm'" class="accordion-body accordion-body--utm">
          <div class="utm-input-grid">
            <input
              v-model="utmSource"
              type="text"
              class="utm-input"
              placeholder="utm_source"
              maxlength="200"
            />
            <input
              v-model="utmMedium"
              type="text"
              class="utm-input"
              placeholder="utm_medium"
              maxlength="200"
            />
            <input
              v-model="utmCampaign"
              type="text"
              class="utm-input"
              placeholder="utm_campaign"
              maxlength="200"
            />
          </div>
          <p v-if="fieldErrors.utmError" class="field-error">{{ fieldErrors.utmError }}</p>
          <div class="utm-preview">{{ utmPreview }}</div>
        </div>
      </div>

      <!-- Phase 8 "Custom OG-Tags" accordion section (08-UI-SPEC.md Surface B,
           META-02, UI-08-03/06). Sits between the UTM section and Passwort &
           Ablauf on the shared accordion shell (openSection). -->
      <div class="accordion-section">
        <div
          class="accordion-header accordion-header--og"
          role="button"
          tabindex="0"
          :aria-expanded="openSection === 'og'"
          @click="toggleSection('og')"
          @keydown.enter.prevent="toggleSection('og')"
          @keydown.space.prevent="toggleSection('og')"
        >
          <span>
            Custom OG-Tags<span v-if="ogSummary" class="accordion-summary"> {{ ogSummary }}</span>
          </span>
          <span class="accordion-chevron">{{ openSection === "og" ? "⌃" : "⌄" }}</span>
        </div>
        <div v-if="openSection === 'og'" class="accordion-body accordion-body--og">
          <div class="og-input-column">
            <input
              v-model="ogTitle"
              type="text"
              class="og-input"
              placeholder="OG-Titel"
              maxlength="200"
            />
            <p v-if="fieldErrors.ogTitleError" class="field-error">{{ fieldErrors.ogTitleError }}</p>
            <input
              v-model="ogDescription"
              type="text"
              class="og-input"
              placeholder="OG-Beschreibung"
              maxlength="500"
            />
            <p v-if="fieldErrors.ogDescriptionError" class="field-error">
              {{ fieldErrors.ogDescriptionError }}
            </p>
            <input
              v-model="ogImageUrl"
              type="text"
              class="og-input mono"
              placeholder="Bild-URL"
              maxlength="2048"
            />
            <p v-if="fieldErrors.ogImageUrlError" class="field-error">{{ fieldErrors.ogImageUrlError }}</p>
            <p class="og-hint">
              Social-Netzwerke zeigen typischerweise ca. 60 Zeichen Titel und ca. 155 Zeichen
              Beschreibung.
            </p>
          </div>

          <!-- Surface B social-card live preview (08-05 Task 2). Always
               rendered while the section is open — even with all three
               fields empty (hatch + locked placeholders), never an
               empty-state swap. -->
          <div class="og-preview-column">
            <div class="og-card">
              <div class="og-card-image">
                <!-- The browser (not our server) fetches this URL once it's
                     bound — D-08-04/T-08-SSRF-CLIENT: no server-side fetch
                     is ever introduced by this preview. -->
                <img
                  v-if="ogDebouncedImageSrc && !ogImageLoadFailed"
                  :src="ogDebouncedImageSrc"
                  class="og-card-img"
                  @error="handleOgImageError"
                />
                <span v-else class="og-card-image-label">OG-Bild</span>
              </div>
              <div class="og-card-text">
                <div class="og-card-title">{{ ogTitle || "OG-Titel erscheint hier" }}</div>
                <div class="og-card-desc">{{ ogDescription || "Beschreibung erscheint hier" }}</div>
                <div class="og-card-domain">{{ ogCardDomain }}</div>
              </div>
            </div>
            <p class="og-card-caption">Vorschau · Slack / X / LinkedIn</p>
          </div>
        </div>
      </div>

      <!-- Passwort & Ablauf accordion section (05-UI-SPEC.md § Link-Formular-
           Erweiterung; generalized onto the shared accordion shell in
           Phase 8, UI-08-01/04 — see the `openSection` ref above). -->
      <div class="accordion-section">
        <div
          class="accordion-header accordion-header--sec"
          role="button"
          tabindex="0"
          :aria-expanded="openSection === 'sec'"
          @click="toggleSection('sec')"
          @keydown.enter.prevent="toggleSection('sec')"
          @keydown.space.prevent="toggleSection('sec')"
        >
          <span>
            Passwort &amp; Ablauf<span v-if="accordionSummary" class="accordion-summary">
              {{ accordionSummary }}</span
            >
          </span>
          <span class="accordion-chevron">{{ openSection === "sec" ? "⌃" : "⌄" }}</span>
        </div>
        <div v-if="openSection === 'sec'" class="accordion-body accordion-body--sec">
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

/* Shared accordion shell (05-UI-SPEC.md, LOCKED tokens; generalized in
   Phase 8, UI-08-04, from the single-section `.security-*` names shipped
   in Phase 5 to generic `.accordion-*` ones shared by all three sections
   — Passwort & Ablauf ("sec") plus the Phase 8 UTM/OG sections. Each
   section's distinct body layout lives in its own `.accordion-body--*`
   modifier rather than duplicating the shared shell three times. */
.accordion-section {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.accordion-header {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.accordion-header:hover {
  background: var(--hover);
}

.accordion-summary {
  font-size: 13px;
  font-weight: 400;
  color: var(--mut);
}

.accordion-chevron {
  color: var(--mut);
}

/* Base body: only the shell every section shares (border + padding). The
   Passwort & Ablauf body's two-column grid is a `--sec`-only modifier —
   Phase 8's UTM/OG bodies use a different padding/layout (see their own
   modifiers), so the grid must not leak onto them. */
.accordion-body {
  padding: 14px;
  border-top: 1px solid var(--border);
}

.accordion-body--sec {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* Shared padding token for the UTM/OG bodies (08-UI-SPEC.md Surface A/B
   Layout Contract: `padding:4px 14px 14px`) — the OG body's own
   display/gap rules are filled in by the next plan. */
.accordion-body--utm,
.accordion-body--og {
  padding: 4px 14px 14px;
}

/* Phase 8 Surface A: UTM-Parameter body (08-04 Task 3, 08-UI-SPEC.md
   LOCKED tokens, Prototyp Z.702). */
.accordion-body--utm {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.utm-input-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  padding-top: 10px;
}

.utm-input {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-size: 12.5px;
  font-family: "Geist Mono", monospace;
}

.utm-preview {
  font-size: 11.5px;
  font-family: "Geist Mono", monospace;
  background: var(--chip);
  border-radius: 8px;
  padding: 10px 12px;
  word-break: break-all;
  color: var(--mut);
  line-height: 1.6;
}

/* Phase 8 Surface B: Custom OG-Tags body (08-05, 08-UI-SPEC.md LOCKED
   tokens, Prototyp Z.719). The shared `padding:4px 14px 14px` for both
   `--utm`/`--og` bodies is already declared above; this rule only adds
   the two-column flex layout distinct to this section. */
.accordion-body--og {
  display: flex;
  gap: 12px;
}

/* Left column: the three OG inputs + hint line (08-05 Task 1). */
.og-input-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
}

.og-input {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-size: 12.5px;
}

/* Only the image-URL input is monospace (Prototyp Z.723) — title and
   description stay in the default Geist family (Z.721/722). */
.og-input.mono {
  font-family: "Geist Mono", monospace;
}

.og-hint {
  font-size: 11px;
  color: var(--mut);
  margin: 0;
}

/* Right column: the 210px social-card live preview (08-05 Task 2). */
.og-preview-column {
  width: 210px;
  flex: none;
  padding-top: 10px;
}

.og-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg);
}

.og-card-image {
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Theme-token hatch (no hardcoded colour, automatically light/dark
     correct) — stays underneath a loaded <img>, which covers it visually
     (Prototyp Z.727). */
  background: repeating-linear-gradient(45deg, var(--chip), var(--chip) 8px, var(--bg) 8px, var(--bg) 16px);
}

.og-card-image-label {
  font-size: 10px;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
}

.og-card-img {
  width: 100%;
  height: 76px;
  object-fit: cover;
  display: block;
}

.og-card-text {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.og-card-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.og-card-desc {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--mut);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.og-card-domain {
  font-size: 9.5px;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
}

.og-card-caption {
  font-size: 10px;
  color: var(--mut);
  margin-top: 5px;
  text-align: center;
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
