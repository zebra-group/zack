/**
 * Component test for InviteMemberModal (09-UI-SPEC.md Layout Contract —
 * Surface C, §8, TEAM-01, UI-09-11). No API mocking needed — the component
 * never calls the network itself, it only emits `submit` with the form
 * payload; the parent (TeamView) owns the actual inviteMember call and
 * maps the last `ApiError` to the `error` prop via `../api.ts`'s
 * `mapTeamError` (mirrors LinkFormModal.test.ts's no-mock convention).
 */
import { mount } from "@vue/test-utils";
import type { DomainDTO } from "@kurzly/shared";
import { describe, expect, it } from "vitest";
import InviteMemberModal from "./InviteMemberModal.vue";

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

const domains = [makeDomain({ id: "d1", hostname: "s.meinefirma.de" }), makeDomain({ id: "d2", hostname: "s2.meinefirma.de" })];

describe("InviteMemberModal", () => {
  it("defaults to Mitglied and shows the domain-toggle block", () => {
    const wrapper = mount(InviteMemberModal, { props: { domains } });
    expect(wrapper.find(".domain-block").exists()).toBe(true);
    expect(wrapper.findAll(".role-card")[1]!.classes()).toContain("selected");
  });

  it("hides the domain block when the Admin role card is selected, and shows it again for Mitglied", async () => {
    const wrapper = mount(InviteMemberModal, { props: { domains } });

    await wrapper.findAll(".role-card")[0]!.trigger("click");
    expect(wrapper.find(".domain-block").exists()).toBe(false);
    expect(wrapper.findAll(".role-card")[0]!.classes()).toContain("selected");

    await wrapper.findAll(".role-card")[1]!.trigger("click");
    expect(wrapper.find(".domain-block").exists()).toBe(true);
  });

  it("renders an inline .field-error and does not emit submit for an empty email", async () => {
    const wrapper = mount(InviteMemberModal, { props: { domains } });

    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.find(".field-error").exists()).toBe(true);
    expect(wrapper.find(".field-error").text()).toBe("Bitte eine gültige E-Mail-Adresse angeben.");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("renders an inline .field-error and does not emit submit for a shape-invalid email", async () => {
    const wrapper = mount(InviteMemberModal, { props: { domains } });

    await wrapper.find("input").setValue("not-an-email");
    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.find(".field-error").exists()).toBe(true);
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("emits submit with email/accountRole/domainIds for a valid Mitglied invite", async () => {
    const wrapper = mount(InviteMemberModal, { props: { domains } });

    await wrapper.find("input").setValue("kollege@firma.de");
    await wrapper.findAll(".domain-pill")[0]!.trigger("click");
    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")).toEqual([
      [{ email: "kollege@firma.de", accountRole: "member", domainIds: ["d1"] }],
    ]);
  });

  it("emits submit with domainIds undefined for a valid Admin invite", async () => {
    const wrapper = mount(InviteMemberModal, { props: { domains } });

    await wrapper.find("input").setValue("kollege@firma.de");
    await wrapper.findAll(".role-card")[0]!.trigger("click");
    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")).toEqual([
      [{ email: "kollege@firma.de", accountRole: "admin", domainIds: undefined }],
    ]);
  });

  it("renders the parent-mapped error prop under the email field when no client error is present", () => {
    const wrapper = mount(InviteMemberModal, {
      props: { domains, error: "Aktion fehlgeschlagen. Bitte erneut versuchen." },
    });

    expect(wrapper.find(".field-error").text()).toBe("Aktion fehlgeschlagen. Bitte erneut versuchen.");
  });

  it("emits close when the overlay, ✕, or Abbrechen is used", async () => {
    const wrapper = mount(InviteMemberModal, { props: { domains } });

    await wrapper.find(".modal-close").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.find(".btn-secondary").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(2);
  });
});
