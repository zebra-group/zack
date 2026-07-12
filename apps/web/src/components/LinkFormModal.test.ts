/**
 * Component test for LinkFormModal (04-UI-SPEC.md Neuer-Link-/
 * Bearbeiten-Modal, LINK-02/LINK-06, D-04). No API mocking needed — the
 * component never calls the network itself, it only emits `submit`
 * with the form payload; the parent (LinksView/LinkDetailView) owns the
 * actual createLink/updateLink call.
 *
 * Phase 5 (05-UI-SPEC.md § Link-Formular-Erweiterung, D-01/D-02/D-03/D-12):
 * covers the Security accordion (password + date-only expiry) and the
 * forwardQuery toggle — payload shape, keep-vs-clear password semantics
 * (T-05-KEEPCLEAR), and the never-prefilled password guarantee
 * (T-05-PWPREFILL).
 */
import { mount } from "@vue/test-utils";
import type { DomainDTO } from "@kurzly/shared";
import { describe, expect, it } from "vitest";
import LinkFormModal from "./LinkFormModal.vue";
import { ApiError, mapLinkFormError } from "../api";

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

describe("mapLinkFormError", () => {
  it("maps a 409 SLUG_TAKEN ApiError to a slug field error", () => {
    expect(mapLinkFormError(new ApiError(409, "Conflict", "SLUG_TAKEN"))).toEqual({
      slugError: "Dieser Slug ist bereits vergeben.",
    });
  });

  it("maps a 400 SLUG_RESERVED ApiError to a slug field error", () => {
    expect(mapLinkFormError(new ApiError(400, "Bad Request", "SLUG_RESERVED"))).toEqual({
      slugError: "Dieser Slug ist reserviert und kann nicht verwendet werden.",
    });
  });

  it("maps a 400 INVALID_TARGET_URL ApiError to a target-url field error", () => {
    expect(mapLinkFormError(new ApiError(400, "Bad Request", "INVALID_TARGET_URL"))).toEqual({
      targetUrlError: "Das sieht nicht wie eine gültige URL aus (https://…).",
    });
  });

  it("falls back to status-only mapping when no code was parsed (409 -> taken)", () => {
    expect(mapLinkFormError(new ApiError(409, "Conflict"))).toEqual({
      slugError: "Dieser Slug ist bereits vergeben.",
    });
  });

  it("returns {} for a non-ApiError", () => {
    expect(mapLinkFormError(new Error("boom"))).toEqual({});
  });
});

describe("LinkFormModal", () => {
  it("create mode renders a domain Select and no slug-change warning", () => {
    const wrapper = mount(LinkFormModal, {
      props: { mode: "create", domains: [makeDomain()] },
    });

    expect(wrapper.find("select").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Achtung: Slug-Änderung");
    expect(wrapper.text()).toContain("Neuer Link");
  });

  it("edit mode renders the PERSISTENT D-04 slug-change warning and a read-only domain chip", () => {
    const wrapper = mount(LinkFormModal, {
      props: {
        mode: "edit",
        domains: [],
        domainHostname: "s.meinefirma.de",
        initialTargetUrl: "https://example.com",
        initialSlug: "abc123",
      },
    });

    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find(".domain-chip").text()).toBe("s.meinefirma.de");
    expect(wrapper.text()).toContain("Achtung: Slug-Änderung");
    expect(wrapper.text()).toContain("abc123");
    expect(wrapper.text()).toContain("Link bearbeiten");
  });

  it("renders an inline field error when the error prop maps to one", () => {
    const wrapper = mount(LinkFormModal, {
      props: {
        mode: "edit",
        domains: [],
        error: new ApiError(409, "Conflict", "SLUG_TAKEN"),
      },
    });

    expect(wrapper.find(".field-error").text()).toBe("Dieser Slug ist bereits vergeben.");
  });

  it("emits submit with the domainId in create mode (Phase 5: password/expiresAt/forwardQuery default to unset)", async () => {
    const wrapper = mount(LinkFormModal, {
      props: { mode: "create", domains: [makeDomain({ id: "d2" })] },
    });

    await wrapper.find(".field-input.mono").setValue("https://example.com/x");
    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")).toBeTruthy();
    expect(wrapper.emitted("submit")![0]![0]).toEqual({
      domainId: "d2",
      targetUrl: "https://example.com/x",
      slug: undefined,
      password: undefined,
      expiresAt: undefined,
      forwardQuery: false,
    });
  });

  it("emits submit WITHOUT a domainId in edit mode (domain is immutable; Phase 5 fields default to unset)", async () => {
    const wrapper = mount(LinkFormModal, {
      props: {
        mode: "edit",
        domains: [],
        domainHostname: "s.meinefirma.de",
        initialTargetUrl: "https://example.com",
        initialSlug: "abc123",
        initialDomainId: "d1",
      },
    });

    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")![0]![0]).toEqual({
      domainId: undefined,
      targetUrl: "https://example.com",
      slug: "abc123",
      password: undefined,
      expiresAt: undefined,
      forwardQuery: false,
    });
  });

  it("emits close when clicking the overlay or the close icon", async () => {
    const wrapper = mount(LinkFormModal, {
      props: { mode: "create", domains: [] },
    });

    await wrapper.find(".modal-close").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.find(".modal-overlay").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(2);
  });

  it("create mode: typing a password + picking a date + toggling forwardQuery on emits those values", async () => {
    const wrapper = mount(LinkFormModal, {
      props: { mode: "create", domains: [makeDomain({ id: "d2" })] },
    });

    await wrapper.find(".field-input.mono").setValue("https://example.com/x");
    await wrapper.find(".security-header").trigger("click");
    await wrapper.find("input[type='password']").setValue("s3cret");
    await wrapper.find("input[type='date']").setValue("2026-08-01");
    await wrapper.find(".toggle").trigger("click");
    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")![0]![0]).toEqual({
      domainId: "d2",
      targetUrl: "https://example.com/x",
      slug: undefined,
      password: "s3cret",
      expiresAt: "2026-08-01",
      forwardQuery: true,
    });
  });

  it("edit mode with an existing password: the input renders EMPTY with the 'gesetzt' placeholder, and submitting untouched keeps it (undefined)", async () => {
    const wrapper = mount(LinkFormModal, {
      props: {
        mode: "edit",
        domains: [],
        domainHostname: "s.meinefirma.de",
        initialTargetUrl: "https://example.com",
        initialSlug: "abc123",
        initialPasswordProtected: true,
      },
    });

    await wrapper.find(".security-header").trigger("click");
    const pwInput = wrapper.find("input[type='password']");
    expect((pwInput.element as HTMLInputElement).value).toBe("");
    expect(pwInput.attributes("placeholder")).toBe("•••• gesetzt — leer lassen, um beizubehalten");

    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")![0]![0]).toMatchObject({ password: undefined });
  });

  it("edit mode: clicking 'Passwortschutz entfernen' then submitting clears the password (null)", async () => {
    const wrapper = mount(LinkFormModal, {
      props: {
        mode: "edit",
        domains: [],
        domainHostname: "s.meinefirma.de",
        initialTargetUrl: "https://example.com",
        initialSlug: "abc123",
        initialPasswordProtected: true,
      },
    });

    await wrapper.find(".security-header").trigger("click");
    await wrapper.find(".remove-pw-link").trigger("click");
    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")![0]![0]).toMatchObject({ password: null });
  });

  it("edit mode with an existing expiry: clearing the date field emits expiresAt null; leaving it emits the existing value", async () => {
    const wrapperClear = mount(LinkFormModal, {
      props: {
        mode: "edit",
        domains: [],
        domainHostname: "s.meinefirma.de",
        initialTargetUrl: "https://example.com",
        initialSlug: "abc123",
        initialExpiresAt: "2026-08-01",
      },
    });

    await wrapperClear.find(".security-header").trigger("click");
    await wrapperClear.find("input[type='date']").setValue("");
    await wrapperClear.find(".btn-primary").trigger("click");

    expect(wrapperClear.emitted("submit")![0]![0]).toMatchObject({ expiresAt: null });

    const wrapperKeep = mount(LinkFormModal, {
      props: {
        mode: "edit",
        domains: [],
        domainHostname: "s.meinefirma.de",
        initialTargetUrl: "https://example.com",
        initialSlug: "abc123",
        initialExpiresAt: "2026-08-01",
      },
    });

    await wrapperKeep.find(".btn-primary").trigger("click");

    expect(wrapperKeep.emitted("submit")![0]![0]).toMatchObject({ expiresAt: "2026-08-01" });
  });

  it("the Security accordion is collapsed by default and shows a summary suffix once a password is set", async () => {
    const wrapper = mount(LinkFormModal, {
      props: { mode: "create", domains: [makeDomain()] },
    });

    expect(wrapper.find(".security-body").exists()).toBe(false);
    expect(wrapper.find(".security-header").text()).not.toContain("gesetzt");

    await wrapper.find(".security-header").trigger("click");
    await wrapper.find("input[type='password']").setValue("secret");

    expect(wrapper.find(".security-header").text()).toContain("Passwort gesetzt");
  });
});
