/**
 * Component test for TeamView (09-UI-SPEC.md Layout Contract — Surface B,
 * TEAM-01..05, UI-09-*) — replaces ComingSoonView at route /team. 09-06's
 * read-only slice (roster/header/role-model card) is covered by the first
 * describe block below; 09-07 extends it with the mutation wiring: the
 * immediate role-change commit with optimistic chip-swap and safe revert
 * (UI-09-03/04/07), the invite modal (§8), the AssignDomainsModal
 * (UI-09-05/12), and the ⋯-menu remove flow (UI-09-06/07). Mocks `../api`
 * (mirrors QrCodesView.test.ts's `vi.mock` pattern) — no real network
 * happens; `ApiError`/`mapTeamError` come through unmocked via `...actual`.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { DomainDTO, TeamMemberDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamView from "./TeamView.vue";
import { ApiError } from "../api";

const { listTeamMembers, changeMemberRole, assignMemberDomains, removeMember, inviteMember, listDomains } =
  vi.hoisted(() => ({
    listTeamMembers: vi.fn(),
    changeMemberRole: vi.fn(),
    assignMemberDomains: vi.fn(),
    removeMember: vi.fn(),
    inviteMember: vi.fn(),
    listDomains: vi.fn(),
  }));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    listTeamMembers,
    changeMemberRole,
    assignMemberDomains,
    removeMember,
    inviteMember,
    listDomains,
  };
});

function makeDomain(overrides: Partial<DomainDTO> = {}): DomainDTO {
  return {
    id: "d1",
    hostname: "s.meinefirma.de",
    type: "subdomain",
    status: "active",
    verifiedAt: "2026-07-11T00:00:00.000Z",
    lastCheckedAt: null,
    lastCheckError: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function makeMember(overrides: Partial<TeamMemberDTO> = {}): TeamMemberDTO {
  return {
    id: "u1",
    email: "admin@example.com",
    name: "Ada Admin",
    accountRole: "admin",
    status: "active",
    domains: [],
    ...overrides,
  };
}

beforeEach(() => {
  listTeamMembers.mockReset();
  changeMemberRole.mockReset();
  assignMemberDomains.mockReset();
  removeMember.mockReset();
  inviteMember.mockReset();
  listDomains.mockReset();
  listDomains.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeamView (09-06 read-only slice)", () => {
  it("renders a row per member: avatar/name/email, role, domain access, status (UI-09-08/09)", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({
        id: "u1",
        email: "admin@example.com",
        name: "Ada Admin",
        accountRole: "admin",
        status: "active",
        domains: [],
      }),
      makeMember({
        id: "u2",
        email: "mo@example.com",
        name: "Mo Mitglied",
        accountRole: "member",
        status: "active",
        domains: [{ id: "d1", hostname: "s.meinefirma.de" }],
      }),
      makeMember({
        id: "u3",
        email: "pending@example.com",
        name: null,
        accountRole: "member",
        status: "pending",
        domains: [],
      }),
    ]);

    const wrapper = mount(TeamView);
    await flushPromises();

    const rows = wrapper.findAll(".table-row");
    expect(rows).toHaveLength(3);

    // Admin row: accent "alle Domains" pill, no chips/assign pill, Aktiv.
    expect(rows[0]!.text()).toContain("alle Domains");
    expect(rows[0]!.find(".domain-chip").exists()).toBe(false);
    expect(rows[0]!.find(".assign-pill").exists()).toBe(false);
    expect(rows[0]!.find(".status-badge.active").exists()).toBe(true);
    expect(rows[0]!.text()).toContain("Aktiv");

    // Member row: domain chip + "+ zuweisen" pill, no "alle Domains".
    expect(rows[1]!.text()).toContain("s.meinefirma.de");
    expect(rows[1]!.text()).toContain("+ zuweisen");
    expect(rows[1]!.find(".all-domains-pill").exists()).toBe(false);

    // Pending member (no name yet): "(Einladung offen)" + "Ausstehend",
    // status read from u.status verbatim — never re-derived (UI-09-08).
    expect(rows[2]!.text()).toContain("(Einladung offen)");
    expect(rows[2]!.text()).toContain("Ausstehend");
    expect(rows[2]!.find(".status-badge.active").exists()).toBe(false);
  });

  it("shows the locked header counter copy", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1" }),
      makeMember({ id: "u2", accountRole: "member", domains: [] }),
    ]);

    const wrapper = mount(TeamView);
    await flushPromises();

    expect(wrapper.text()).toContain("2 Mitglieder · Rollen & Domain-Zugriff");
  });

  it("renders the title, invite button, table header, and dashed role-model card", async () => {
    listTeamMembers.mockResolvedValue([makeMember()]);

    const wrapper = mount(TeamView);
    await flushPromises();

    expect(wrapper.text()).toContain("Team");
    expect(wrapper.text()).toContain("+ Mitglied einladen");
    expect(wrapper.text()).toContain("Benutzer");
    expect(wrapper.text()).toContain("Rolle");
    expect(wrapper.text()).toContain("Domain-Zugriff");
    expect(wrapper.text()).toContain("Status");
    expect(wrapper.text()).toContain("Rollenmodell:");
    expect(wrapper.text()).toContain("Mitglied");
  });
});

describe("TeamView role change (09-07 Task 1, UI-09-03/04/07)", () => {
  it("commits a role change immediately, swaps chips for the accent pill, and toasts success", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({
        id: "u2",
        email: "mo@example.com",
        accountRole: "member",
        domains: [{ id: "d1", hostname: "s.meinefirma.de" }],
      }),
    ]);
    changeMemberRole.mockResolvedValue({
      id: "u2",
      email: "mo@example.com",
      name: "Mo Mitglied",
      accountRole: "admin",
      status: "active",
      domains: [],
    });

    const wrapper = mount(TeamView);
    await flushPromises();

    const memberRow = wrapper.findAll(".table-row")[1]!;
    await memberRow.find("select").setValue("admin");
    await flushPromises();

    expect(changeMemberRole).toHaveBeenCalledWith("u2", "admin");
    // Optimistic + confirmed: chips replaced by the accent pill in the same tick.
    expect(memberRow.find(".domain-chip").exists()).toBe(false);
    expect(memberRow.text()).toContain("alle Domains");
    expect(wrapper.text()).toContain("Rolle aktualisiert");
    expect(memberRow.find(".member-error-row").exists()).toBe(false);
  });

  it("reverts BOTH role and domain chips on a generic rejection, rendering an inline .member-error-row", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({
        id: "u2",
        email: "mo@example.com",
        accountRole: "member",
        domains: [{ id: "d1", hostname: "s.meinefirma.de" }],
      }),
    ]);
    changeMemberRole.mockRejectedValue(new ApiError(500, "Internal Server Error"));

    const wrapper = mount(TeamView);
    await flushPromises();

    const memberRow = wrapper.findAll(".table-row")[1]!;
    await memberRow.find("select").setValue("admin");
    await flushPromises();

    expect((memberRow.find("select").element as HTMLSelectElement).value).toBe("member");
    expect(memberRow.find(".domain-chip").exists()).toBe(true);
    expect(memberRow.find(".all-domains-pill").exists()).toBe(false);

    const errorRow = wrapper.findAll(".member-error-row");
    expect(errorRow).toHaveLength(1);
    expect(errorRow[0]!.text()).toBe("Aktion fehlgeschlagen. Bitte erneut versuchen.");
  });

  it("shows the locked LAST_ADMIN copy inline and reverts the select on a 409 LAST_ADMIN rejection", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({ id: "u2", email: "second-admin@example.com", accountRole: "admin" }),
    ]);
    changeMemberRole.mockRejectedValue(new ApiError(409, "Conflict", "LAST_ADMIN"));

    const wrapper = mount(TeamView);
    await flushPromises();

    const secondAdminRow = wrapper.findAll(".table-row")[1]!;
    await secondAdminRow.find("select").setValue("member");
    await flushPromises();

    expect((secondAdminRow.find("select").element as HTMLSelectElement).value).toBe("admin");
    const errorRow = wrapper.findAll(".member-error-row");
    expect(errorRow).toHaveLength(1);
    expect(errorRow[0]!.text()).toBe("Es muss mindestens ein Admin bestehen bleiben.");
  });

  it("proactively disables the sole remaining admin's role select with an explanatory title", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({ id: "u2", email: "mo@example.com", accountRole: "member", domains: [] }),
    ]);

    const wrapper = mount(TeamView);
    await flushPromises();

    const soleAdminSelect = wrapper.findAll(".table-row")[0]!.find("select");
    expect(soleAdminSelect.attributes("disabled")).toBeDefined();
    expect(soleAdminSelect.attributes("title")).toBeTruthy();

    const memberSelect = wrapper.findAll(".table-row")[1]!.find("select");
    expect(memberSelect.attributes("disabled")).toBeUndefined();
  });
});

describe("TeamView invite flow (09-07 Task 2, §8/UI-09-11, D-09-04)", () => {
  it("opens InviteMemberModal from the + Mitglied einladen button", async () => {
    listTeamMembers.mockResolvedValue([makeMember()]);

    const wrapper = mount(TeamView);
    await flushPromises();

    expect(wrapper.find(".modal-dialog").exists()).toBe(false);
    await wrapper.find(".invite-button").trigger("click");

    expect(wrapper.find(".modal-dialog").exists()).toBe(true);
    expect(wrapper.text()).toContain("Mitglied einladen");
  });

  it("invites a member, appends a new pending row without reload, toasts, and closes the modal", async () => {
    listTeamMembers.mockResolvedValue([makeMember({ id: "u1", accountRole: "admin" })]);
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);
    inviteMember.mockResolvedValue({
      id: "u2",
      email: "neu@example.com",
      name: null,
      accountRole: "member",
      status: "pending",
      domains: [{ id: "d1", hostname: "s.meinefirma.de" }],
    });

    const wrapper = mount(TeamView);
    await flushPromises();

    await wrapper.find(".invite-button").trigger("click");
    await wrapper.find(".modal-dialog input").setValue("neu@example.com");
    await wrapper.findAll(".domain-pill")[0]!.trigger("click");
    await wrapper.find(".modal-dialog .btn-primary").trigger("click");
    await flushPromises();

    expect(inviteMember).toHaveBeenCalledWith({
      email: "neu@example.com",
      accountRole: "member",
      domainIds: ["d1"],
    });
    expect(wrapper.findAll(".table-row")).toHaveLength(2);
    expect(wrapper.text()).toContain("(Einladung offen)");
    expect(wrapper.text()).toContain("Magic Link an neu@example.com gesendet");
    expect(wrapper.find(".modal-dialog").exists()).toBe(false);
  });

  it("re-invites an existing address as a non-error resend, updating (not duplicating) the row", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({
        id: "u2",
        email: "pending@example.com",
        name: null,
        accountRole: "member",
        status: "pending",
        domains: [],
      }),
    ]);
    listDomains.mockResolvedValue([]);
    inviteMember.mockResolvedValue({
      id: "u2",
      email: "pending@example.com",
      name: null,
      accountRole: "member",
      status: "pending",
      domains: [],
    });

    const wrapper = mount(TeamView);
    await flushPromises();

    await wrapper.find(".invite-button").trigger("click");
    await wrapper.find(".modal-dialog input").setValue("pending@example.com");
    await wrapper.find(".modal-dialog .btn-primary").trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".table-row")).toHaveLength(2);
    expect(wrapper.text()).toContain("Magic Link an pending@example.com gesendet");
  });

  it("maps a rejected invite to the modal's inline error and keeps it open", async () => {
    listTeamMembers.mockResolvedValue([makeMember({ id: "u1", accountRole: "admin" })]);
    listDomains.mockResolvedValue([]);
    inviteMember.mockRejectedValue(new ApiError(400, "Bad Request"));

    const wrapper = mount(TeamView);
    await flushPromises();

    await wrapper.find(".invite-button").trigger("click");
    await wrapper.find(".modal-dialog input").setValue("neu@example.com");
    await wrapper.find(".modal-dialog .btn-primary").trigger("click");
    await flushPromises();

    expect(wrapper.find(".modal-dialog").exists()).toBe(true);
    expect(wrapper.find(".field-error").text()).toBe("Aktion fehlgeschlagen. Bitte erneut versuchen.");
    expect(wrapper.findAll(".table-row")).toHaveLength(1);
  });
});

describe("TeamView assign-domains flow (09-07 Task 3, UI-09-05/12, TEAM-03)", () => {
  it("opens AssignDomainsModal pre-filled from the '+ zuweisen' pill and updates chips on save", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({
        id: "u2",
        email: "mo@example.com",
        accountRole: "member",
        domains: [{ id: "d1", hostname: "s.meinefirma.de" }],
      }),
    ]);
    listDomains.mockResolvedValue([
      makeDomain({ id: "d1", hostname: "s.meinefirma.de" }),
      makeDomain({ id: "d2", hostname: "s2.meinefirma.de" }),
    ]);
    assignMemberDomains.mockResolvedValue({
      id: "u2",
      email: "mo@example.com",
      name: "Mo Mitglied",
      accountRole: "member",
      status: "active",
      domains: [{ id: "d2", hostname: "s2.meinefirma.de" }],
    });

    const wrapper = mount(TeamView);
    await flushPromises();

    const memberRow = wrapper.findAll(".table-row")[1]!;
    await memberRow.find(".assign-pill").trigger("click");

    expect(wrapper.text()).toContain("Domains zuweisen");
    const pills = wrapper.findAll(".domain-pill");
    expect(pills[0]!.classes()).toContain("selected");
    expect(pills[1]!.classes()).not.toContain("selected");

    await pills[0]!.trigger("click");
    await pills[1]!.trigger("click");
    await wrapper.find(".modal-dialog .btn-primary").trigger("click");
    await flushPromises();

    expect(assignMemberDomains).toHaveBeenCalledWith("u2", ["d2"]);
    expect(wrapper.find(".modal-dialog").exists()).toBe(false);
    expect(wrapper.text()).toContain("Domain-Zugriff aktualisiert");
    expect(memberRow.text()).toContain("s2.meinefirma.de");
    expect(memberRow.text()).not.toContain("s.meinefirma.de");
  });

  it("also opens AssignDomainsModal from clicking an existing domain chip", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({
        id: "u2",
        email: "mo@example.com",
        accountRole: "member",
        domains: [{ id: "d1", hostname: "s.meinefirma.de" }],
      }),
    ]);
    listDomains.mockResolvedValue([makeDomain({ id: "d1", hostname: "s.meinefirma.de" })]);

    const wrapper = mount(TeamView);
    await flushPromises();

    await wrapper.findAll(".table-row")[1]!.find(".domain-chip").trigger("click");

    expect(wrapper.text()).toContain("Domains zuweisen");
  });

  it("never offers a clickable domain assignment for an admin row (UI-09-12)", async () => {
    listTeamMembers.mockResolvedValue([makeMember({ id: "u1", accountRole: "admin" })]);
    listDomains.mockResolvedValue([]);

    const wrapper = mount(TeamView);
    await flushPromises();

    const adminRow = wrapper.findAll(".table-row")[0]!;
    expect(adminRow.find(".all-domains-pill").attributes("role")).toBeUndefined();
    expect(adminRow.find(".all-domains-pill").attributes("tabindex")).toBeUndefined();
  });
});

describe("TeamView remove flow (09-07 Task 3, UI-09-06/07, TEAM-05)", () => {
  it("removes a member via the ⋯ menu's shared delete dialog and toasts success", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({ id: "u2", email: "mo@example.com", accountRole: "member", domains: [] }),
    ]);
    listDomains.mockResolvedValue([]);
    removeMember.mockResolvedValue(undefined);

    const wrapper = mount(TeamView);
    await flushPromises();

    const memberRow = wrapper.findAll(".table-row")[1]!;
    await memberRow.find(".menu-cell").trigger("click");
    await wrapper.find(".action-menu-item").trigger("click");

    expect(wrapper.text()).toContain("Mitglied entfernen?");
    expect(wrapper.text()).toContain("mo@example.com verliert den Zugriff auf Kurzly");

    await wrapper.find(".delete-confirm-button").trigger("click");
    await flushPromises();

    expect(removeMember).toHaveBeenCalledWith("u2");
    expect(wrapper.findAll(".table-row")).toHaveLength(1);
    expect(wrapper.text()).toContain("mo@example.com entfernt");
    expect(wrapper.find(".delete-dialog").exists()).toBe(false);
  });

  it("shows a .dialog-error with the locked LAST_ADMIN copy and keeps the dialog open on lockout", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({ id: "u2", email: "second-admin@example.com", accountRole: "admin" }),
    ]);
    listDomains.mockResolvedValue([]);
    removeMember.mockRejectedValue(new ApiError(409, "Conflict", "LAST_ADMIN"));

    const wrapper = mount(TeamView);
    await flushPromises();

    const secondAdminRow = wrapper.findAll(".table-row")[1]!;
    await secondAdminRow.find(".menu-cell").trigger("click");
    await wrapper.find(".action-menu-item").trigger("click");
    await wrapper.find(".delete-confirm-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".delete-dialog").exists()).toBe(true);
    expect(wrapper.find(".dialog-error").text()).toBe("Es muss mindestens ein Admin bestehen bleiben.");
    expect(wrapper.findAll(".table-row")).toHaveLength(2);
  });

  it("disables the sole admin's 'Mitglied entfernen' entry with an explanatory title", async () => {
    listTeamMembers.mockResolvedValue([
      makeMember({ id: "u1", accountRole: "admin" }),
      makeMember({ id: "u2", email: "mo@example.com", accountRole: "member", domains: [] }),
    ]);
    listDomains.mockResolvedValue([]);

    const wrapper = mount(TeamView);
    await flushPromises();

    const adminRow = wrapper.findAll(".table-row")[0]!;
    await adminRow.find(".menu-cell").trigger("click");
    const item = wrapper.find(".action-menu-item");

    expect(item.classes()).toContain("disabled");
    expect(item.attributes("title")).toBeTruthy();

    await item.trigger("click");
    expect(wrapper.find(".delete-dialog").exists()).toBe(false);
  });
});
