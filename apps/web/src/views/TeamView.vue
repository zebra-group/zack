<script setup lang="ts">
/**
 * Team screen (09-UI-SPEC.md Layout Contract — Surface B, TEAM-01/02,
 * UI-09-08/09) — replaces ComingSoonView at route /team (admin-only,
 * UI-09-01). This plan (09-06) is the READ-ONLY slice: loads the full
 * member roster and renders it exactly per the locked contract — avatar +
 * name/email, role <select> (present, no @change wired), domain-access
 * pills, status badge, and the dashed role-model note card. The invite
 * button, role <select> onChange, "+ zuweisen"/domain-chip click, and the
 * ⋯ action menu render present but INERT — their mutation handlers and the
 * two modals (InviteMemberModal/AssignDomainsModal) land in 09-07.
 *
 * UI-09-08 (T-09-STATUS-REDERIVE): the status badge reads `member.status`
 * verbatim — never re-derives it from `emailVerified`, which never crosses
 * the JSON boundary on this DTO (see packages/shared TeamMemberDTO).
 */
import { computed, ref } from "vue";
import type { TeamMemberDTO } from "@kurzly/shared";
import { listTeamMembers } from "../api";

const members = ref<TeamMemberDTO[]>([]);
const toastMessage = ref<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

const memberCountLabel = computed(
  () => `${members.value.length} Mitglieder · Rollen & Domain-Zugriff`,
);

async function loadMembers(): Promise<void> {
  try {
    members.value = await listTeamMembers();
  } catch {
    showToast("Team konnte nicht geladen werden.");
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
 * UI-09-09: initials derived from the name if present, else from the
 * email — mirrors the prototype's `initials(u.name, u.email)`.
 */
function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/** UI-09-09: a pending invitee has no name yet. */
function displayName(member: TeamMemberDTO): string {
  return member.name?.trim() || "(Einladung offen)";
}

/** UI-09-08: reads member.status verbatim, never emailVerified. */
function statusLabel(status: TeamMemberDTO["status"]): string {
  return status === "active" ? "Aktiv" : "Ausstehend";
}

/** Placeholder — real invite flow (InviteMemberModal) wired in 09-07. */
function openInvite(): void {
  // no-op in this plan (09-06)
}

loadMembers();
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>Team</h1>
      <p class="member-count">{{ memberCountLabel }}</p>
      <div class="spacer"></div>
      <button type="button" class="invite-button" @click="openInvite">
        + Mitglied einladen
      </button>
    </div>

    <div class="team-table">
      <div class="table-header">
        <span>Benutzer</span>
        <span>Rolle</span>
        <span>Domain-Zugriff</span>
        <span>Status</span>
        <span></span>
      </div>

      <div v-for="member in members" :key="member.id" class="table-row">
        <div class="user-cell">
          <div class="avatar">{{ initials(member.name, member.email) }}</div>
          <div class="user-info">
            <div class="user-name">{{ displayName(member) }}</div>
            <div class="user-email">{{ member.email }}</div>
          </div>
        </div>

        <div class="role-cell">
          <select class="role-select" :value="member.accountRole">
            <option value="admin">Admin</option>
            <option value="member">Mitglied</option>
          </select>
        </div>

        <div class="domain-cell">
          <span v-if="member.accountRole === 'admin'" class="all-domains-pill">
            alle Domains
          </span>
          <template v-else>
            <span v-for="domain in member.domains" :key="domain.id" class="domain-chip">
              {{ domain.hostname }}
            </span>
            <span class="assign-pill">+ zuweisen</span>
          </template>
        </div>

        <div class="status-cell">
          <span class="status-badge" :class="{ active: member.status === 'active' }">
            {{ statusLabel(member.status) }}
          </span>
        </div>

        <div class="menu-cell">⋯</div>
      </div>
    </div>

    <div class="role-model-card">
      <span class="role-model-label">Rollenmodell:</span>
      <span class="role-model-label">Admin</span> verwaltet alles (Links, Domains, QR, Team,
      Auth). <span class="role-model-label">Mitglied</span> sieht und bearbeitet ausschließlich
      Links, QR-Codes &amp; Analytics der ihm zugewiesenen Domains.
    </div>
  </div>

  <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
</template>

<style scoped>
/* Container (09-UI-SPEC.md LOCKED Z.366) */
.screen-container {
  max-width: 1000px;
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

.member-count {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

.spacer {
  flex: 1;
}

.invite-button {
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #1b1b18;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.invite-button:hover {
  opacity: 0.85;
}

/* Table card (LOCKED Z.374-412) */
.team-table {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.table-header,
.table-row {
  display: grid;
  grid-template-columns: 1fr 130px 1fr 96px 28px;
  gap: 12px;
  align-items: center;
}

.table-header {
  padding: 9px 16px;
  font-size: 11px;
  color: var(--mut);
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.table-row {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.avatar {
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  background: var(--chip);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mut);
}

.user-info {
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-email {
  font-size: 11.5px;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.role-select {
  width: 100%;
  font-size: 12px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  outline: none;
}

.domain-cell {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.all-domains-pill {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent);
  color: #1b1b18;
  font-weight: 600;
}

.domain-chip {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--mut);
  font-family: "Geist Mono", monospace;
}

.assign-pill {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px dashed var(--border);
  color: var(--mut);
  cursor: pointer;
}

.assign-pill:hover {
  border-color: var(--mut);
  color: var(--text);
}

.status-badge {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  font-weight: 600;
  background: var(--chip);
  color: var(--mut);
}

.status-badge.active {
  background: var(--accent);
  color: #1b1b18;
}

.menu-cell {
  color: var(--mut);
  text-align: center;
  cursor: pointer;
}

.menu-cell:hover {
  color: var(--text);
}

/* Role-model note card (LOCKED Z.453) */
.role-model-card {
  background: var(--panel);
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 12px;
  color: var(--mut);
}

.role-model-label {
  font-weight: 500;
  color: var(--text);
}

/* Toast (global pattern, reused from DomainsView) */
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
