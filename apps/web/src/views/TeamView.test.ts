/**
 * Component test for TeamView (09-UI-SPEC.md Layout Contract — Surface B,
 * TEAM-01/02, UI-09-08/09) — replaces ComingSoonView at route /team. This
 * plan (09-06) is the read-only slice: renders the full roster from
 * listTeamMembers, the role-model note card, and the header counter. The
 * role <select>/invite button/⋯ menu render present but inert — their
 * mutation wiring lands in 09-07. Mocks `../api` (mirrors
 * QrCodesView.test.ts's `vi.mock` pattern) — no real network happens.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { TeamMemberDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamView from "./TeamView.vue";

const { listTeamMembers } = vi.hoisted(() => ({
  listTeamMembers: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, listTeamMembers };
});

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
