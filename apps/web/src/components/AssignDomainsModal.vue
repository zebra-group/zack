<script setup lang="ts">
/**
 * Assign-domains modal (09-UI-SPEC.md Layout Contract — Surface D,
 * Auto-Decision UI-09-05/12, TEAM-03). Same overlay/dialog shell as
 * InviteMemberModal.vue (460px) and the IDENTICAL domain toggle-pill
 * block — reproduced here rather than extracted into a shared component,
 * matching this codebase's convention of small per-modal duplication over
 * a shared library (see LinkFormModal.vue's own self-contained styles).
 * Owns its selection state locally, pre-seeded from the member's CURRENT
 * domains (`initialDomainIds`) — TeamView only renders this component
 * while `showAssignFor` is set, so `v-if` mounts a fresh instance per
 * open, mirroring InviteMemberModal's per-open-state idiom. The parent
 * (TeamView) owns the actual `assignMemberDomains` call and passes back
 * the last mapped error string via the `error` prop.
 */
import { ref } from "vue";
import type { DomainDTO } from "@zack/shared";

type AssignDomainsModalProps = {
  /** Active domains only — the same set InviteMemberModal uses. */
  domains: DomainDTO[];
  memberEmail: string;
  initialDomainIds: string[];
  /** Last submit error from the parent, mapped via ../api.ts's mapTeamError. */
  error?: string | null;
};

const props = defineProps<AssignDomainsModalProps>();

const emit = defineEmits<{
  close: [];
  submit: [domainIds: string[]];
}>();

const selectedDomainIds = ref<string[]>([...props.initialDomainIds]);

function toggleDomain(id: string): void {
  const idx = selectedDomainIds.value.indexOf(id);
  if (idx >= 0) selectedDomainIds.value.splice(idx, 1);
  else selectedDomainIds.value.push(id);
}

function handleSubmit(): void {
  emit("submit", [...selectedDomainIds.value]);
}
</script>

<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="modal-dialog" @click.stop>
      <div class="modal-header">
        <h3 class="modal-title">Domains zuweisen</h3>
        <span class="modal-close" @click="emit('close')">✕</span>
      </div>
      <p class="modal-subtext">Wähle die Domains, auf die {{ memberEmail }} zugreifen darf.</p>

      <div class="field domain-block">
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

      <p v-if="error" class="field-error">{{ error }}</p>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" @click="emit('close')">Abbrechen</button>
        <button type="button" class="btn-primary" @click="handleSubmit">Speichern</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Overlay + dialog shell — identical to InviteMemberModal.vue's Surface C
   shell (09-UI-SPEC.md: "Gleiche Overlay/Dialog-Shell wie Surface C"). */
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

.field-error {
  font-size: 11.5px;
  color: #e5484d;
  margin: 0;
}

/* Domain toggle pills — identical block to InviteMemberModal.vue (LOCKED
   Z.601-608 + Z.1096-1103). */
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
