<script setup lang="ts">
/**
 * Invite-member modal (09-UI-SPEC.md Layout Contract — Surface C, §8,
 * TEAM-01, UI-09-11). Owns its own form state (fresh per open — TeamView
 * only renders this component while `showInviteModal` is true, so `v-if`
 * mounts a fresh instance each time, mirroring LinkFormModal's per-open-
 * state idiom). The parent (TeamView) owns the actual `inviteMember` call
 * and passes back the last mapped error string via the `error` prop
 * (mapped through ../api.ts's `mapTeamError` — no dedicated invite error
 * mapper; this plan's api.ts scope (Task 1) is the four mutation clients
 * + mapTeamError only).
 *
 * Client-side email shape validation only gates the inline `.field-error`
 * (UI-09-11) — the server remains authoritative (T-09-UI-BOUNDARY); the
 * server's own validation failure surfaces through the same `.field-error`
 * via the `error` prop.
 */
import { computed, ref } from "vue";
import type { AccountRole, DomainDTO } from "@kurzly/shared";

type InviteMemberModalProps = {
  /** Active domains only (member-only toggle source, same set AssignDomainsModal uses). */
  domains: DomainDTO[];
  /** Last submit error from the parent, mapped via ../api.ts's mapTeamError. */
  error?: string | null;
};

const props = defineProps<InviteMemberModalProps>();

const emit = defineEmits<{
  close: [];
  submit: [payload: { email: string; accountRole: AccountRole; domainIds?: string[] }];
}>();

const email = ref("");
const role = ref<AccountRole>("member");
const selectedDomainIds = ref<string[]>([]);
const clientEmailError = ref<string | null>(null);

/** Client validation takes precedence; otherwise falls back to the parent's mapped server error. */
const displayedEmailError = computed(() => clientEmailError.value ?? props.error ?? null);

const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_SHAPE_RE.test(value.trim());
}

function selectRole(next: AccountRole): void {
  role.value = next;
}

function toggleDomain(id: string): void {
  const idx = selectedDomainIds.value.indexOf(id);
  if (idx >= 0) selectedDomainIds.value.splice(idx, 1);
  else selectedDomainIds.value.push(id);
}

function handleSubmit(): void {
  const trimmed = email.value.trim();
  if (!isValidEmail(trimmed)) {
    clientEmailError.value = "Bitte eine gültige E-Mail-Adresse angeben.";
    return;
  }
  clientEmailError.value = null;
  emit("submit", {
    email: trimmed,
    accountRole: role.value,
    domainIds: role.value === "member" ? [...selectedDomainIds.value] : undefined,
  });
}
</script>

<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="modal-dialog" @click.stop>
      <div class="modal-header">
        <h3 class="modal-title">Mitglied einladen</h3>
        <span class="modal-close" @click="emit('close')">✕</span>
      </div>
      <p class="modal-subtext">Die Person erhält einen Magic Link zur Anmeldung — kein Passwort.</p>

      <div class="field">
        <label class="field-label">E-Mail</label>
        <input v-model="email" type="text" class="field-input mono" placeholder="kollege@firma.de" />
        <p v-if="displayedEmailError" class="field-error">{{ displayedEmailError }}</p>
      </div>

      <div class="field">
        <label class="field-label">Rolle</label>
        <div class="role-cards" role="radiogroup" aria-label="Rolle">
          <div
            class="role-card"
            :class="{ selected: role === 'admin' }"
            role="radio"
            :aria-checked="role === 'admin'"
            tabindex="0"
            @click="selectRole('admin')"
            @keydown.enter.prevent="selectRole('admin')"
            @keydown.space.prevent="selectRole('admin')"
          >
            <div class="role-card-title">Admin</div>
            <div class="role-card-desc">Vollzugriff auf alles</div>
          </div>
          <div
            class="role-card"
            :class="{ selected: role === 'member' }"
            role="radio"
            :aria-checked="role === 'member'"
            tabindex="0"
            @click="selectRole('member')"
            @keydown.enter.prevent="selectRole('member')"
            @keydown.space.prevent="selectRole('member')"
          >
            <div class="role-card-title">Mitglied</div>
            <div class="role-card-desc">Nur zugewiesene Domains</div>
          </div>
        </div>
      </div>

      <div v-if="role === 'member'" class="field domain-block">
        <label class="field-label">Domain-Zugriff</label>
        <div class="domain-pills">
          <span
            v-for="domain in domains"
            :key="domain.id"
            class="domain-pill"
            :class="{ selected: selectedDomainIds.includes(domain.id) }"
            role="button"
            :aria-pressed="selectedDomainIds.includes(domain.id)"
            tabindex="0"
            @click="toggleDomain(domain.id)"
            @keydown.enter="toggleDomain(domain.id)"
            @keydown.space.prevent="toggleDomain(domain.id)"
          >
            {{ domain.hostname }}
          </span>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" @click="emit('close')">Abbrechen</button>
        <button type="button" class="btn-primary" @click="handleSubmit">Magic Link senden</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Overlay + dialog shell (09-UI-SPEC.md LOCKED Z.578-579) — reused verbatim
   by AssignDomainsModal.vue (Surface D, same shell). */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 20px;
  z-index: 55;
}

.modal-dialog {
  width: 460px;
  max-width: 100%;
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
  font-size: 16px;
  padding: 2px 6px;
}

.modal-close:hover {
  color: var(--text);
}

.modal-subtext {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
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

/* Role cards (LOCKED Z.590-597 + Z.1090-1093). */
.role-cards {
  display: flex;
  gap: 8px;
}

.role-card {
  flex: 1;
  padding: 10px 12px;
  border: 1.5px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  cursor: pointer;
}

.role-card.selected {
  border-color: var(--accent);
  background: var(--chip);
}

.role-card-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.role-card-desc {
  font-size: 11px;
  font-weight: 400;
  color: var(--mut);
  margin-top: 2px;
}

/* Domain toggle pills (LOCKED Z.601-608 + Z.1096-1103) — reused verbatim by
   AssignDomainsModal.vue. */
.domain-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.domain-pill {
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--mut);
  font-family: "Geist Mono", monospace;
  font-weight: 400;
  cursor: pointer;
}

.domain-pill.selected {
  border-color: var(--accent);
  background: var(--accent);
  color: #1b1b18;
  font-weight: 600;
}

.modal-footer {
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
</style>
