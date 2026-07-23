/**
 * Component test for AssignDomainsModal (09-UI-SPEC.md Layout Contract —
 * Surface D, Auto-Decision UI-09-05/12, TEAM-03). No API mocking needed —
 * the component never calls the network itself, it only emits `submit`
 * with the chosen domain ids; the parent (TeamView) owns the actual
 * assignMemberDomains call (mirrors InviteMemberModal.test.ts's no-mock
 * convention).
 */
import { mount } from "@vue/test-utils";
import type { DomainDTO } from "@kurzly/shared";
import { describe, expect, it } from "vitest";
import AssignDomainsModal from "./AssignDomainsModal.vue";

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

const domains = [
  makeDomain({ id: "d1", hostname: "s.meinefirma.de" }),
  makeDomain({ id: "d2", hostname: "s2.meinefirma.de" }),
];

describe("AssignDomainsModal", () => {
  it("pre-selects the member's current domains", () => {
    const wrapper = mount(AssignDomainsModal, {
      props: { domains, memberEmail: "mo@example.com", initialDomainIds: ["d2"] },
    });

    const pills = wrapper.findAll(".domain-pill");
    expect(pills[0]!.classes()).not.toContain("selected");
    expect(pills[0]!.attributes("aria-pressed")).toBe("false");
    expect(pills[1]!.classes()).toContain("selected");
    expect(pills[1]!.attributes("aria-pressed")).toBe("true");
  });

  it("shows the member's email in the subtext", () => {
    const wrapper = mount(AssignDomainsModal, {
      props: { domains, memberEmail: "mo@example.com", initialDomainIds: [] },
    });

    expect(wrapper.text()).toContain("mo@example.com");
  });

  it("emits submit with the toggled selection on Speichern", async () => {
    const wrapper = mount(AssignDomainsModal, {
      props: { domains, memberEmail: "mo@example.com", initialDomainIds: ["d1"] },
    });

    await wrapper.findAll(".domain-pill")[0]!.trigger("click"); // deselect d1
    await wrapper.findAll(".domain-pill")[1]!.trigger("click"); // select d2
    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")).toEqual([[["d2"]]]);
  });

  it("renders the parent-mapped error prop when present", () => {
    const wrapper = mount(AssignDomainsModal, {
      props: {
        domains,
        memberEmail: "mo@example.com",
        initialDomainIds: [],
        error: "Aktion fehlgeschlagen. Bitte erneut versuchen.",
      },
    });

    expect(wrapper.find(".field-error").text()).toBe("Aktion fehlgeschlagen. Bitte erneut versuchen.");
  });

  it("emits close when the overlay, ✕, or Abbrechen is used", async () => {
    const wrapper = mount(AssignDomainsModal, {
      props: { domains, memberEmail: "mo@example.com", initialDomainIds: [] },
    });

    await wrapper.find(".modal-close").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.find(".btn-secondary").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(2);
  });
});
