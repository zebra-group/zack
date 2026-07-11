<script setup lang="ts">
/**
 * Domain management screen (03-UI-SPEC.md, DOMAIN-01/02/04) — replaces
 * ComingSoonView at route /domains. List / add / verify / DNS-instructions
 * / delete-confirm / empty-state, driving the Phase-3 API. Screen container
 * is 860px max-width — NOT the generic 1060px .screen-container used by
 * other screens (03-UI-SPEC.md Layout Contract).
 *
 * T-03-09 (Elevation of Privilege): every create/verify/delete/instructions
 * call below is independently re-authorized server-side — this UI hides
 * or shows actions purely for convenience, never as the access boundary.
 */
import { ref } from "vue";
import type { DomainDTO } from "@kurzly/shared";
import {
  ApiError,
  createDomain,
  deleteDomain,
  getDomainInstructions,
  listDomains,
  verifyDomain,
  type DomainInstructions,
} from "../api";

interface DomainUI extends DomainDTO {
  isVerifying: boolean;
  showInstructions: boolean;
  instructions?: DomainInstructions;
  /** Transient inline error from the last verify attempt (not persisted). */
  verifyError?: string | null;
}

const domains = ref<DomainUI[]>([]);
const newHostname = ref("");
const newType = ref<"subdomain" | "apex">("subdomain");
const typeManuallySet = ref(false);
const toastMessage = ref<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
const deleteTarget = ref<DomainUI | null>(null);

function toDomainUI(dto: DomainDTO): DomainUI {
  return { ...dto, isVerifying: false, showInstructions: false };
}

async function loadDomains(): Promise<void> {
  try {
    domains.value = (await listDomains()).map(toDomainUI);
  } catch {
    showToast("Domains konnten nicht geladen werden.");
  }
}

function showToast(message: string): void {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMessage.value = message;
  toastTimeout = setTimeout(() => {
    toastMessage.value = null;
  }, 1700);
}

/**
 * Auto-preselects Subdomain/Apex based on the input as the admin types
 * (03-UI-SPEC.md Copywriting Contract): more than 2 labels before the
 * public-suffix boundary implies a subdomain, otherwise apex. Overridable —
 * once the admin manually clicks a toggle pill, auto-preselection stops.
 */
function autoPreselect(): void {
  if (typeManuallySet.value) return;
  const labels = newHostname.value.trim().split(".").filter(Boolean);
  newType.value = labels.length > 2 ? "subdomain" : "apex";
}

function selectType(type: "subdomain" | "apex"): void {
  newType.value = type;
  typeManuallySet.value = true;
}

async function handleAddDomain(): Promise<void> {
  const hostname = newHostname.value.trim();
  if (!hostname) {
    showToast("Bitte eine Domain eingeben.");
    return;
  }

  try {
    const created = await createDomain({ hostname, type: newType.value });
    domains.value.push(toDomainUI(created));
    showToast(`${hostname} hinzugefügt — DNS ausstehend`);
    newHostname.value = "";
    typeManuallySet.value = false;
    newType.value = "subdomain";
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      showToast("Diese Domain ist bereits registriert.");
    } else {
      showToast("Das sieht nicht wie eine gültige Domain aus.");
    }
  }
}

async function handleVerify(domain: DomainUI): Promise<void> {
  domain.isVerifying = true;
  domain.verifyError = null;
  try {
    const updated = await verifyDomain(domain.id);
    Object.assign(domain, updated);
    if (updated.status === "active") {
      showToast(`${domain.hostname} verifiziert ✓`);
    } else {
      domain.verifyError = `DNS-Eintrag für ${domain.hostname} noch nicht gefunden. Bitte prüfe deine DNS-Konfiguration.`;
    }
  } catch (err) {
    domain.verifyError =
      err instanceof ApiError && err.status === 429
        ? "Zu viele Prüfungen. Bitte warte kurz, bevor du es erneut versuchst."
        : `DNS-Eintrag für ${domain.hostname} noch nicht gefunden. Bitte prüfe deine DNS-Konfiguration.`;
  } finally {
    domain.isVerifying = false;
  }
}

async function toggleInstructions(domain: DomainUI): Promise<void> {
  if (domain.showInstructions) {
    domain.showInstructions = false;
    return;
  }

  if (!domain.instructions) {
    try {
      domain.instructions = await getDomainInstructions(domain.id);
    } catch {
      showToast("Anleitung konnte nicht geladen werden.");
      return;
    }
  }
  domain.showInstructions = true;
}

function requestDelete(domain: DomainUI): void {
  deleteTarget.value = domain;
}

function cancelDelete(): void {
  deleteTarget.value = null;
}

async function confirmDelete(): Promise<void> {
  const domain = deleteTarget.value;
  if (!domain) return;

  try {
    await deleteDomain(domain.id);
    domains.value = domains.value.filter((d) => d.id !== domain.id);
    deleteTarget.value = null;
  } catch {
    showToast("Domain konnte nicht entfernt werden.");
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast("DNS-Eintrag kopiert");
  } catch {
    showToast("Kopieren fehlgeschlagen");
  }
}

function statusLabel(status: DomainDTO["status"]): string {
  if (status === "active") return "Aktiv";
  if (status === "failed") return "Fehlgeschlagen";
  return "DNS ausstehend";
}

function relativeTime(iso: string): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSeconds < 60) return "gerade eben";
  if (diffSeconds < 3600) return `vor ${Math.floor(diffSeconds / 60)} Minuten`;
  if (diffSeconds < 86400) return `vor ${Math.floor(diffSeconds / 3600)} Stunden`;
  return `vor ${Math.floor(diffSeconds / 86400)} Tagen`;
}

loadDomains();
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>Domains</h1>
      <p class="subtitle">Domains &amp; Subdomains, die auf die Instanz zeigen</p>
    </div>

    <div class="add-domain-row">
      <input
        v-model="newHostname"
        type="text"
        class="domain-input"
        placeholder="z.B. s.meinefirma.de"
        @input="autoPreselect"
        @keydown.enter="handleAddDomain"
      />
      <div class="type-toggle">
        <button
          type="button"
          :class="{ active: newType === 'subdomain' }"
          @click="selectType('subdomain')"
        >
          Subdomain
        </button>
        <button
          type="button"
          :class="{ active: newType === 'apex' }"
          @click="selectType('apex')"
        >
          Apex-Domain
        </button>
      </div>
      <button type="button" class="add-button" @click="handleAddDomain">Hinzufügen</button>
    </div>

    <div v-if="domains.length === 0" class="empty-state">
      <div class="empty-icon">🌐</div>
      <h3 class="empty-heading">Noch keine Domain registriert</h3>
      <p class="empty-body">
        Füge oben deine erste Domain oder Subdomain hinzu, um Kurzlinks darauf zu betreiben.
      </p>
    </div>

    <div v-else class="domain-list">
      <template v-for="(domain, idx) in domains" :key="domain.id">
        <div class="domain-row" :class="{ 'row-last': idx === domains.length - 1 }">
          <div class="domain-name">{{ domain.hostname }}</div>
          <span class="type-badge">{{ domain.type.toUpperCase() }}</span>
          <span
            class="status-badge"
            :class="{ active: domain.status === 'active', failed: domain.status === 'failed' }"
          >
            {{ statusLabel(domain.status) }}
          </span>
          <div class="spacer"></div>
          <button
            v-if="domain.status !== 'active'"
            type="button"
            class="verify-button"
            :disabled="domain.isVerifying"
            @click="handleVerify(domain)"
          >
            {{ domain.isVerifying ? "Prüfe …" : "Jetzt prüfen" }}
          </button>
          <button type="button" class="instructions-toggle" @click="toggleInstructions(domain)">
            {{ domain.showInstructions ? "Anleitung ausblenden ▾" : "Anleitung anzeigen ▸" }}
          </button>
          <button
            type="button"
            class="delete-button"
            title="Domain entfernen"
            @click="requestDelete(domain)"
          >
            🗑
          </button>
        </div>

        <div v-if="domain.verifyError" class="verify-error-row">{{ domain.verifyError }}</div>

        <div v-if="domain.showInstructions && domain.instructions" class="instructions-panel">
          <p class="instructions-body">
            {{
              domain.type === "subdomain"
                ? `Lege bei deinem DNS-Anbieter folgenden CNAME-Eintrag für ${domain.hostname} an:`
                : `Lege bei deinem DNS-Anbieter folgenden A-Eintrag für ${domain.hostname} an (oder einen ALIAS-/ANAME-Eintrag, falls dein Anbieter das unterstützt):`
            }}
          </p>
          <div class="dns-code-block">
            <code>{{ domain.instructions.instructions }}</code>
            <button
              type="button"
              class="copy-button"
              title="Kopieren"
              @click="copyToClipboard(domain.instructions.instructions)"
            >
              ⧉
            </button>
          </div>
          <p v-if="domain.type === 'apex' && domain.instructions.alternativeForApex" class="dns-alt">
            oder: {{ domain.instructions.alternativeForApex }}
          </p>
          <p class="tls-hint">
            Sobald diese Domain auf „Aktiv" steht, kann dein Reverse-Proxy (z. B. Caddy
            On-Demand-TLS, Traefik) automatisch ein Let's-Encrypt-Zertifikat ausstellen — TLS
            terminiert dein eigener Proxy, nicht Kurzly.
          </p>
          <p v-if="domain.lastCheckedAt" class="last-checked" :class="{ error: !!domain.lastCheckError }">
            Zuletzt geprüft: {{ relativeTime(domain.lastCheckedAt) }}
            <template v-if="domain.lastCheckError"> — {{ domain.lastCheckError }}</template>
          </p>
        </div>
      </template>
    </div>
  </div>

  <div v-if="deleteTarget" class="delete-dialog-overlay" @click="cancelDelete">
    <div class="delete-dialog" @click.stop>
      <h3 class="delete-title">Domain entfernen?</h3>
      <p class="delete-body">
        {{ deleteTarget.hostname }} wird entfernt. Bestehende Links auf dieser Domain
        funktionieren danach nicht mehr.
      </p>
      <div class="delete-footer">
        <button type="button" class="cancel-button" @click="cancelDelete">Abbrechen</button>
        <button type="button" class="delete-confirm-button" @click="confirmDelete">
          Entfernen
        </button>
      </div>
    </div>
  </div>

  <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
</template>

<style scoped>
/* Screen container (03-UI-SPEC.md lines 214-219: 860px max-width, NOT the
   generic 1060px .screen-container). */
.screen-container {
  max-width: 860px;
  margin: 0 auto;
  padding: 28px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.subtitle {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

/* Add-domain row (UI-SPEC lines 228-247) */
.add-domain-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.domain-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  font-family: "Geist Mono", monospace;
  outline: none;
}

.type-toggle {
  display: flex;
  gap: 4px;
  flex: none;
}

.type-toggle button {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  cursor: pointer;
  background: var(--panel);
  color: var(--mut);
  font-weight: 400;
  border: 1px solid var(--border);
}

.type-toggle button.active {
  background: var(--accent);
  color: #1b1b18;
  font-weight: 500;
  border-color: var(--accent);
}

.add-button {
  padding: 9px 16px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #1b1b18;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  flex: none;
}

.add-button:hover {
  opacity: 0.85;
}

/* Domain list card (UI-SPEC lines 250-289) */
.domain-list {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.domain-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
}

.domain-row.row-last {
  border-bottom: none;
}

.domain-name {
  font-family: "Geist Mono", monospace;
  font-size: 13.5px;
  width: 230px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--mut);
  text-transform: uppercase;
  white-space: nowrap;
}

.status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--mut);
}

.status-badge.active {
  background: var(--accent);
  color: #1b1b18;
}

.status-badge.failed {
  background: var(--chip);
  color: #e5484d;
}

.spacer {
  flex: 1;
}

.verify-button,
.instructions-toggle {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  flex: none;
}

.instructions-toggle {
  border: none;
  background: transparent;
  color: var(--mut);
  padding: 5px 8px;
}

.verify-button:hover {
  background: var(--hover);
}

.instructions-toggle:hover {
  color: var(--text);
}

.verify-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.delete-button {
  border: none;
  background: transparent;
  padding: 3px;
  color: var(--mut);
  font-size: 13px;
  cursor: pointer;
  flex: none;
}

.delete-button:hover {
  color: #e5484d;
}

.verify-error-row {
  padding: 0 16px 12px;
  font-size: 11.5px;
  color: #e5484d;
  background: var(--panel);
}

/* Instructions accordion (UI-SPEC lines 291-313) */
.instructions-panel {
  border-top: 1px dashed var(--border);
  padding: 14px 16px 16px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.instructions-body {
  font-size: 12px;
  color: var(--mut);
  margin: 0;
}

.dns-code-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-family: "Geist Mono", monospace;
  font-size: 12px;
  background: var(--chip);
  border-radius: 8px;
  padding: 12px 14px;
  line-height: 1.7;
  color: var(--text);
}

.dns-code-block code {
  flex: 1;
  white-space: pre-wrap;
}

.copy-button {
  font-size: 11px;
  color: var(--mut);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 1px 5px;
  cursor: pointer;
  background: transparent;
  flex: none;
}

.copy-button:hover {
  color: var(--text);
  border-color: var(--mut);
}

.dns-alt {
  font-size: 11.5px;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
  margin: 0;
}

.tls-hint {
  font-size: 12px;
  color: var(--mut);
  margin: 0;
}

.last-checked {
  font-size: 11.5px;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
  margin: 0;
}

.last-checked.error {
  color: #e5484d;
}

/* Empty state (UI-SPEC lines 340-350) */
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

/* Delete confirmation dialog (UI-SPEC lines 323-338) */
.delete-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
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
  margin-top: 6px;
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

/* Toast (UI-SPEC lines 352-358, global pattern reused from Phase 2) */
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
