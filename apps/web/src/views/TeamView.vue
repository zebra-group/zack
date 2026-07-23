<script setup lang="ts">
/**
 * Team screen (09-UI-SPEC.md Layout Contract — Surface B, TEAM-01..05,
 * UI-09-*) — replaces ComingSoonView at route /team (admin-only, UI-09-01).
 * 09-06 built the READ-ONLY slice (roster load, avatar/name/email, status
 * badge, role-model card). This plan (09-07) wires the mutation surface:
 * the role <select> commits immediately (UI-09-03), a member->admin change
 * swaps domain chips for the "alle Domains" pill in the same optimistic
 * update and rolls BOTH back together on failure (UI-09-04), and a
 * client-side `lastAdmin` computed proactively disables the sole admin's
 * select with an explanatory `title` (UI-09-07) — the server (09-04) stays
 * authoritative regardless.
 *
 * UI-09-08 (T-09-STATUS-REDERIVE): the status badge reads `member.status`
 * verbatim — never re-derives it from `emailVerified`, which never crosses
 * the JSON boundary on this DTO (see packages/shared TeamMemberDTO).
 */
import { computed, ref } from "vue";
import type { AccountRole, DomainDTO, TeamMemberDTO } from "@kurzly/shared";
import {
  assignMemberDomains,
  changeMemberRole,
  inviteMember,
  listDomains,
  listTeamMembers,
  mapTeamError,
  removeMember,
} from "../api";
import AssignDomainsModal from "../components/AssignDomainsModal.vue";
import InviteMemberModal from "../components/InviteMemberModal.vue";

/** Adds a transient, row-local mutation error (UI-09-03/07's `.member-error-row`) — never persisted server-side. */
interface MemberUI extends TeamMemberDTO {
  error?: string | null;
}

const members = ref<MemberUI[]>([]);
const toastMessage = ref<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

const memberCountLabel = computed(
  () => `${members.value.length} Mitglieder · Rollen & Domain-Zugriff`,
);

/** UI-09-07: the number of current admins in the loaded roster. */
const adminCount = computed(() => members.value.filter((m) => m.accountRole === "admin").length);

/** UI-09-07: proactive client-side guard — the sole remaining admin cannot demote/be-removed via the UI. */
function lastAdmin(member: MemberUI): boolean {
  return member.accountRole === "admin" && adminCount.value === 1;
}

async function loadMembers(): Promise<void> {
  try {
    members.value = (await listTeamMembers()).map((m) => ({ ...m, error: null }));
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
 * UI-09-03/04/07: commits the role change immediately on `change`. A
 * member->admin change swaps the domain chips for the "alle Domains" pill
 * in the SAME optimistic update (UI-09-04); a rejection reverts BOTH the
 * role and the domains together and renders a typed inline error via
 * `mapTeamError` (LAST_ADMIN gets its own locked copy, everything else the
 * generic fallback).
 */
async function handleRoleChange(member: MemberUI, event: Event): Promise<void> {
  const newRole = (event.target as HTMLSelectElement).value as AccountRole;
  const previousRole = member.accountRole;
  const previousDomains = member.domains;

  member.error = null;
  member.accountRole = newRole;
  if (newRole === "admin") member.domains = [];

  try {
    const updated = await changeMemberRole(member.id, newRole);
    Object.assign(member, updated);
    showToast("Rolle aktualisiert");
  } catch (err) {
    member.accountRole = previousRole;
    member.domains = previousDomains;
    member.error = mapTeamError(err);
  }
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

/** Active domains only — the member-only toggle source for InviteMemberModal/AssignDomainsModal. */
const activeDomains = ref<DomainDTO[]>([]);

async function loadDomains(): Promise<void> {
  try {
    activeDomains.value = (await listDomains()).filter((d) => d.status === "active");
  } catch {
    // Non-fatal: the invite/assign modals simply show no toggle pills; the
    // roster itself (loadMembers) already surfaces its own load failure.
  }
}

const showInviteModal = ref(false);
const inviteError = ref<string | null>(null);

function openInvite(): void {
  inviteError.value = null;
  showInviteModal.value = true;
}

function closeInvite(): void {
  showInviteModal.value = false;
  inviteError.value = null;
}

/**
 * TEAM-01/D-09-04: appends the returned member as a new row, or — for a
 * re-invite of an existing address — replaces that row in place rather
 * than duplicating it (the server's resend is keyed on the SAME user id).
 */
async function handleInviteSubmit(payload: {
  email: string;
  accountRole: AccountRole;
  domainIds?: string[];
}): Promise<void> {
  try {
    const member = await inviteMember(payload);
    const idx = members.value.findIndex((m) => m.id === member.id);
    if (idx >= 0) members.value[idx] = { ...member, error: null };
    else members.value.push({ ...member, error: null });
    showInviteModal.value = false;
    inviteError.value = null;
    showToast(`Magic Link an ${payload.email} gesendet`);
  } catch (err) {
    inviteError.value = mapTeamError(err);
  }
}

/**
 * UI-09-05/12: the AssignDomainsModal is only reachable for a `"member"`
 * row — an admin's domain-access cell renders the static, non-interactive
 * "alle Domains" pill (an admin already reaches every domain, D-09-02).
 */
const showAssignFor = ref<MemberUI | null>(null);
const assignError = ref<string | null>(null);

function openAssign(member: MemberUI): void {
  if (member.accountRole === "admin") return;
  showAssignFor.value = member;
  assignError.value = null;
}

function closeAssign(): void {
  showAssignFor.value = null;
  assignError.value = null;
}

async function handleAssignSubmit(domainIds: string[]): Promise<void> {
  const member = showAssignFor.value;
  if (!member) return;
  try {
    const updated = await assignMemberDomains(member.id, domainIds);
    Object.assign(member, updated);
    showAssignFor.value = null;
    assignError.value = null;
    showToast("Domain-Zugriff aktualisiert");
  } catch (err) {
    assignError.value = mapTeamError(err);
  }
}

/** UI-09-06: the ⋯ row menu — a single "Mitglied entfernen" entry, keyboard-reachable (Enter/Space) and Escape/blur-closing. */
const openMenuFor = ref<string | null>(null);

function toggleMenu(id: string): void {
  openMenuFor.value = openMenuFor.value === id ? null : id;
}

function closeMenu(): void {
  openMenuFor.value = null;
}

const deleteTarget = ref<MemberUI | null>(null);
const deleteError = ref<string | null>(null);

/** UI-09-06/07: opens the shared delete-confirm dialog; a no-op for the proactively-disabled sole admin. */
function handleRemoveClick(member: MemberUI): void {
  if (lastAdmin(member)) return;
  openMenuFor.value = null;
  deleteTarget.value = member;
  deleteError.value = null;
}

function cancelRemove(): void {
  deleteTarget.value = null;
  deleteError.value = null;
}

/**
 * TEAM-05/D-09-06: removes the member row on success; a LAST_ADMIN
 * rejection (D-09-07) renders a `.dialog-error` INSIDE the still-open
 * dialog rather than closing it (UI-09-07) — the caller can see exactly
 * why nothing happened and retry a different member.
 */
async function confirmRemove(): Promise<void> {
  const member = deleteTarget.value;
  if (!member) return;
  try {
    await removeMember(member.id);
    members.value = members.value.filter((m) => m.id !== member.id);
    deleteTarget.value = null;
    deleteError.value = null;
    showToast(`${member.email} entfernt`);
  } catch (err) {
    deleteError.value = mapTeamError(err);
  }
}

loadMembers();
loadDomains();
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

      <template v-for="member in members" :key="member.id">
        <div class="table-row">
          <div class="user-cell">
            <div class="avatar">{{ initials(member.name, member.email) }}</div>
            <div class="user-info">
              <div class="user-name">{{ displayName(member) }}</div>
              <div class="user-email">{{ member.email }}</div>
            </div>
          </div>

          <div class="role-cell">
            <select
              class="role-select"
              :value="member.accountRole"
              :disabled="lastAdmin(member)"
              :title="lastAdmin(member) ? 'Der letzte Admin kann seine Rolle nicht ändern.' : undefined"
              @change="handleRoleChange(member, $event)"
            >
              <option value="admin">Admin</option>
              <option value="member">Mitglied</option>
            </select>
          </div>

          <div class="domain-cell">
            <span v-if="member.accountRole === 'admin'" class="all-domains-pill">
              alle Domains
            </span>
            <template v-else>
              <span
                v-for="domain in member.domains"
                :key="domain.id"
                class="domain-chip"
                role="button"
                tabindex="0"
                @click="openAssign(member)"
                @keydown.enter="openAssign(member)"
                @keydown.space.prevent="openAssign(member)"
              >
                {{ domain.hostname }}
              </span>
              <span
                class="assign-pill"
                role="button"
                tabindex="0"
                @click="openAssign(member)"
                @keydown.enter="openAssign(member)"
                @keydown.space.prevent="openAssign(member)"
              >
                + zuweisen
              </span>
            </template>
          </div>

          <div class="status-cell">
            <span class="status-badge" :class="{ active: member.status === 'active' }">
              {{ statusLabel(member.status) }}
            </span>
          </div>

          <div
            class="menu-cell"
            role="button"
            tabindex="0"
            @click="toggleMenu(member.id)"
            @keydown.enter.prevent="toggleMenu(member.id)"
            @keydown.space.prevent="toggleMenu(member.id)"
            @keydown.escape="closeMenu"
            @blur="closeMenu"
          >
            ⋯
            <div v-if="openMenuFor === member.id" class="action-menu" @click.stop>
              <div
                class="action-menu-item"
                :class="{ disabled: lastAdmin(member) }"
                :title="lastAdmin(member) ? 'Der letzte Admin kann nicht entfernt werden.' : undefined"
                @mousedown.prevent
                @click="handleRemoveClick(member)"
              >
                Mitglied entfernen
              </div>
            </div>
          </div>
        </div>

        <div v-if="member.error" class="member-error-row">{{ member.error }}</div>
      </template>
    </div>

    <div class="role-model-card">
      <span class="role-model-label">Rollenmodell:</span>
      <span class="role-model-label">Admin</span> verwaltet alles (Links, Domains, QR, Team,
      Auth). <span class="role-model-label">Mitglied</span> sieht und bearbeitet ausschließlich
      Links, QR-Codes &amp; Analytics der ihm zugewiesenen Domains.
    </div>
  </div>

  <InviteMemberModal
    v-if="showInviteModal"
    :domains="activeDomains"
    :error="inviteError"
    @close="closeInvite"
    @submit="handleInviteSubmit"
  />

  <AssignDomainsModal
    v-if="showAssignFor"
    :domains="activeDomains"
    :member-email="showAssignFor.email"
    :initial-domain-ids="showAssignFor.domains.map((d) => d.id)"
    :error="assignError"
    @close="closeAssign"
    @submit="handleAssignSubmit"
  />

  <div v-if="deleteTarget" class="delete-dialog-overlay" @click="cancelRemove">
    <div class="delete-dialog" @click.stop>
      <h3 class="delete-title">Mitglied entfernen?</h3>
      <p class="delete-body">
        {{ deleteTarget.email }} verliert den Zugriff auf Kurzly. Bereits erstellte Links und
        QR-Codes bleiben erhalten.
      </p>
      <p v-if="deleteError" class="dialog-error">{{ deleteError }}</p>
      <div class="delete-footer">
        <button type="button" class="cancel-button" @click="cancelRemove">Abbrechen</button>
        <button type="button" class="delete-confirm-button" @click="confirmRemove">Entfernen</button>
      </div>
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
  cursor: pointer;
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
  position: relative;
  color: var(--mut);
  text-align: center;
  cursor: pointer;
}

.menu-cell:hover {
  color: var(--text);
}

/* UI-09-06 ⋯ action menu. */
.action-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 10;
  min-width: 150px;
  overflow: hidden;
  text-align: left;
}

.action-menu-item {
  padding: 8px 12px;
  font-size: 12.5px;
  color: #e5484d;
  cursor: pointer;
  white-space: nowrap;
}

.action-menu-item:hover {
  background: var(--hover);
}

.action-menu-item.disabled {
  color: var(--mut);
  cursor: not-allowed;
  opacity: 0.6;
}

/* Inline row mutation error (UI-09-03/04/07) — style = DomainsView's
   .verify-error-row (03-UI-SPEC.md). */
.member-error-row {
  padding: 0 16px 12px;
  font-size: 11.5px;
  color: #e5484d;
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

/* Delete-confirmation dialog (UI-09-06, reused verbatim from DomainsView.vue
   Surface E). */
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

/* UI-09-07: in-dialog LAST_ADMIN lockout error, style = .member-error-row. */
.dialog-error {
  font-size: 11.5px;
  color: #e5484d;
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
