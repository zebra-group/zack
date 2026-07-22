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
      trackingEnabled: true,
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
      trackingEnabled: true,
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
    await wrapper.find(".accordion-header--sec").trigger("click");
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
      trackingEnabled: true,
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

    await wrapper.find(".accordion-header--sec").trigger("click");
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

    await wrapper.find(".accordion-header--sec").trigger("click");
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

    await wrapperClear.find(".accordion-header--sec").trigger("click");
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

    expect(wrapper.find(".accordion-body--sec").exists()).toBe(false);
    expect(wrapper.find(".accordion-header--sec").text()).not.toContain("gesetzt");

    await wrapper.find(".accordion-header--sec").trigger("click");
    await wrapper.find("input[type='password']").setValue("secret");

    expect(wrapper.find(".accordion-header--sec").text()).toContain("Passwort gesetzt");
  });

  // Phase 8 (UI-08-01/02/04): the single-boolean accordion became an
  // exclusive multi-section shell with generic `.accordion-*` classes.
  // Full cross-section exclusivity (opening one closes another) is
  // exercised end-to-end once a second section exists (08-04 Task 3 adds
  // the UTM section onto the same `openSection` ref) — these cases cover
  // what Task 1 alone can render: the toggle mechanics and a11y contract
  // on the one section that exists at this point in the sweep.
  describe("accordion shell (Phase 8, UI-08-01/02/04)", () => {
    it("the section header exposes role=button, tabindex=0, and aria-expanded tracking open state", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      const header = wrapper.find(".accordion-header--sec");
      expect(header.attributes("role")).toBe("button");
      expect(header.attributes("tabindex")).toBe("0");
      expect(header.attributes("aria-expanded")).toBe("false");

      await header.trigger("click");
      expect(header.attributes("aria-expanded")).toBe("true");
    });

    it("clicking an open section header closes it again — at most one body renders at a time", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      const header = wrapper.find(".accordion-header--sec");
      await header.trigger("click");
      expect(wrapper.find(".accordion-body--sec").exists()).toBe(true);

      await header.trigger("click");
      expect(wrapper.find(".accordion-body--sec").exists()).toBe(false);
    });

    it("Enter and Space on a focused header toggle it exactly like a click", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      const header = wrapper.find(".accordion-header--sec");
      await header.trigger("keydown.enter");
      expect(wrapper.find(".accordion-body--sec").exists()).toBe(true);

      await header.trigger("keydown.space");
      expect(wrapper.find(".accordion-body--sec").exists()).toBe(false);
    });

    it("every retired .security-* class name is gone from the rendered markup", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });
      await wrapper.find(".accordion-header--sec").trigger("click");

      const html = wrapper.html();
      expect(html).not.toContain("security-section");
      expect(html).not.toContain("security-header");
      expect(html).not.toContain("security-summary");
      expect(html).not.toContain("security-chevron");
      expect(html).not.toContain("security-body");
    });
  });

  // Phase 6 footer tracking toggle (06-UI-SPEC.md § C1, TRACK-01/D-15).
  it("create mode: the footer tracking toggle defaults ON and shows the 'Internes Tracking' label with no helper text", () => {
    const wrapper = mount(LinkFormModal, {
      props: { mode: "create", domains: [makeDomain()] },
    });

    const group = wrapper.find(".tracking-toggle-group");
    const toggle = group.find(".toggle");
    expect(toggle.classes()).toContain("active");
    expect(toggle.attributes("aria-checked")).toBe("true");
    expect(group.text()).toBe("Internes Tracking");
  });

  it("edit mode: the footer tracking toggle is pre-filled from initialTrackingEnabled=false", () => {
    const wrapper = mount(LinkFormModal, {
      props: {
        mode: "edit",
        domains: [],
        domainHostname: "s.meinefirma.de",
        initialTargetUrl: "https://example.com",
        initialSlug: "abc123",
        initialTrackingEnabled: false,
      },
    });

    const toggle = wrapper.find(".tracking-toggle-group .toggle");
    expect(toggle.classes()).not.toContain("active");
    expect(toggle.attributes("aria-checked")).toBe("false");
  });

  it("clicking the footer tracking toggle flips it, and submit emits the current value", async () => {
    const wrapper = mount(LinkFormModal, {
      props: { mode: "create", domains: [makeDomain({ id: "d2" })] },
    });

    await wrapper.find(".field-input.mono").setValue("https://example.com/x");
    await wrapper.find(".tracking-toggle-group .toggle").trigger("click");

    expect(wrapper.find(".tracking-toggle-group .toggle").classes()).not.toContain("active");

    await wrapper.find(".btn-primary").trigger("click");

    expect(wrapper.emitted("submit")![0]![0]).toMatchObject({ trackingEnabled: false });
  });

  it("the footer uses space-between with the toggle group left and the buttons grouped right", () => {
    const wrapper = mount(LinkFormModal, {
      props: { mode: "create", domains: [makeDomain()] },
    });

    expect(wrapper.find(".footer-buttons").findAll("button")).toHaveLength(2);
    expect(wrapper.find(".tracking-toggle-group").exists()).toBe(true);
  });

  // Phase 8 (08-04 Task 3, META-01, 08-UI-SPEC.md Surface A): the
  // "UTM-Parameter" accordion section with its three inputs and live
  // destination preview.
  describe("UTM-Parameter section (Surface A)", () => {
    it("renders above the Passwort & Ablauf section, closed by default, with no summary suffix when nothing is set", () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      const headers = wrapper.findAll(".accordion-header");
      expect(headers[0]!.classes()).toContain("accordion-header--utm");
      expect(headers[0]!.text()).toContain("UTM-Parameter");
      expect(headers[0]!.text()).not.toContain("gesetzt");
      expect(wrapper.find(".accordion-body--utm").exists()).toBe(false);

      const secIndex = headers.findIndex((h) => h.classes().includes("accordion-header--sec"));
      const utmIndex = headers.findIndex((h) => h.classes().includes("accordion-header--utm"));
      expect(utmIndex).toBeLessThan(secIndex);
    });

    it("shows the live preview reflecting the typed target URL unchanged when no UTM value is set", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      await wrapper.find(".accordion-header--utm").trigger("click");
      await wrapper.find(".field-input.mono").setValue("https://example.com/x");

      expect(wrapper.find(".utm-preview").text()).toBe("https://example.com/x");
    });

    it("updates the preview synchronously per keystroke in any of the three UTM inputs, with the header summary counting non-empty fields", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      await wrapper.find(".accordion-header--utm").trigger("click");
      await wrapper.find(".field-input.mono").setValue("https://example.com/x");

      const inputs = wrapper.findAll(".utm-input");
      await inputs[0]!.setValue("newsletter");
      expect(wrapper.find(".utm-preview").text()).toBe("https://example.com/x?utm_source=newsletter");
      expect(wrapper.find(".accordion-header--utm").text()).toContain("· 1 gesetzt");

      await inputs[1]!.setValue("email");
      await inputs[2]!.setValue("launch");
      expect(wrapper.find(".utm-preview").text()).toBe(
        "https://example.com/x?utm_source=newsletter&utm_medium=email&utm_campaign=launch",
      );
      expect(wrapper.find(".accordion-header--utm").text()).toContain("· 3 gesetzt");
    });

    it("keeps the preview live even while the section is closed and then reopened (no frozen snapshot)", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      await wrapper.find(".field-input.mono").setValue("https://example.com/x");
      await wrapper.find(".accordion-header--utm").trigger("click");
      await wrapper.find(".utm-input").setValue("newsletter");
      await wrapper.find(".accordion-header--utm").trigger("click"); // close

      await wrapper.find(".field-input.mono").setValue("https://example.com/y");
      await wrapper.find(".accordion-header--utm").trigger("click"); // reopen

      expect(wrapper.find(".utm-preview").text()).toBe(
        "https://example.com/y?utm_source=newsletter",
      );
    });

    it("in edit mode the three inputs are pre-filled from the passed-in initial values", async () => {
      const wrapper = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          domainHostname: "s.meinefirma.de",
          initialTargetUrl: "https://example.com",
          initialSlug: "abc123",
          initialUtmSource: "newsletter",
          initialUtmMedium: "email",
          initialUtmCampaign: "launch",
        },
      });

      await wrapper.find(".accordion-header--utm").trigger("click");
      const inputs = wrapper.findAll(".utm-input");
      expect((inputs[0]!.element as HTMLInputElement).value).toBe("newsletter");
      expect((inputs[1]!.element as HTMLInputElement).value).toBe("email");
      expect((inputs[2]!.element as HTMLInputElement).value).toBe("launch");
      expect(wrapper.find(".accordion-header--utm").text()).toContain("· 3 gesetzt");
    });

    it("submitting an untouched form omits the three UTM keys from the payload", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain({ id: "d2" })] },
      });

      await wrapper.find(".field-input.mono").setValue("https://example.com/x");
      await wrapper.find(".btn-primary").trigger("click");

      expect(wrapper.emitted("submit")![0]![0]).toMatchObject({
        utmSource: undefined,
        utmMedium: undefined,
        utmCampaign: undefined,
      });
    });

    it("submitting after clearing a pre-filled field sends that key as an explicit clear (null), and a typed value is sent as-is", async () => {
      const wrapper = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          domainHostname: "s.meinefirma.de",
          initialTargetUrl: "https://example.com",
          initialSlug: "abc123",
          initialUtmSource: "newsletter",
          initialUtmMedium: "email",
        },
      });

      await wrapper.find(".accordion-header--utm").trigger("click");
      const inputs = wrapper.findAll(".utm-input");
      await inputs[0]!.setValue(""); // clear the pre-filled source
      await inputs[2]!.setValue("launch"); // set the never-populated campaign

      await wrapper.find(".btn-primary").trigger("click");

      expect(wrapper.emitted("submit")![0]![0]).toMatchObject({
        utmSource: null,
        utmMedium: "email",
        utmCampaign: "launch",
      });
    });

    it("renders the locked UTM-too-long inline error beneath the input grid, and nothing for an unrelated error", async () => {
      const wrapperUtmError = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          error: new ApiError(400, "Bad Request", "UTM_VALUE_TOO_LONG"),
        },
      });
      await wrapperUtmError.find(".accordion-header--utm").trigger("click");
      expect(wrapperUtmError.find(".accordion-body--utm .field-error").text()).toBe(
        "Maximal 200 Zeichen pro UTM-Wert.",
      );

      const wrapperOtherError = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          error: new ApiError(409, "Conflict", "SLUG_TAKEN"),
        },
      });
      await wrapperOtherError.find(".accordion-header--utm").trigger("click");
      expect(wrapperOtherError.find(".accordion-body--utm .field-error").exists()).toBe(false);
    });
  });

  // Phase 8 (08-05 Task 1, META-02, 08-UI-SPEC.md Surface B): the
  // "Custom OG-Tags" accordion section's input column, hint line and
  // payload threading. The right-hand social-card preview (Task 2) is
  // covered in its own describe block below.
  describe("Custom OG-Tags section (Surface B) — input column", () => {
    it("renders between the UTM section and Passwort & Ablauf, closed by default, with no summary suffix when nothing is set", () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      const headers = wrapper.findAll(".accordion-header");
      const utmIndex = headers.findIndex((h) => h.classes().includes("accordion-header--utm"));
      const ogIndex = headers.findIndex((h) => h.classes().includes("accordion-header--og"));
      const secIndex = headers.findIndex((h) => h.classes().includes("accordion-header--sec"));
      expect(utmIndex).toBeLessThan(ogIndex);
      expect(ogIndex).toBeLessThan(secIndex);

      const ogHeader = wrapper.find(".accordion-header--og");
      expect(ogHeader.text()).toContain("Custom OG-Tags");
      expect(ogHeader.text()).not.toContain("gesetzt");
      expect(wrapper.find(".accordion-body--og").exists()).toBe(false);
    });

    it("the header summary counts non-empty OG fields as they are typed", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      await wrapper.find(".accordion-header--og").trigger("click");
      const inputs = wrapper.findAll(".og-input");
      await inputs[0]!.setValue("A title");
      expect(wrapper.find(".accordion-header--og").text()).toContain("· 1 gesetzt");

      await inputs[1]!.setValue("A description");
      await inputs[2]!.setValue("https://example.com/img.png");
      expect(wrapper.find(".accordion-header--og").text()).toContain("· 3 gesetzt");
    });

    it("opening the OG section closes an open UTM section, and vice versa (UI-08-01 exclusivity)", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      await wrapper.find(".accordion-header--utm").trigger("click");
      expect(wrapper.find(".accordion-body--utm").exists()).toBe(true);

      await wrapper.find(".accordion-header--og").trigger("click");
      expect(wrapper.find(".accordion-body--utm").exists()).toBe(false);
      expect(wrapper.find(".accordion-body--og").exists()).toBe(true);

      await wrapper.find(".accordion-header--utm").trigger("click");
      expect(wrapper.find(".accordion-body--og").exists()).toBe(false);
      expect(wrapper.find(".accordion-body--utm").exists()).toBe(true);
    });

    it("renders the three inputs with locked placeholders, maxlengths and per-field font family", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      await wrapper.find(".accordion-header--og").trigger("click");
      const inputs = wrapper.findAll(".og-input");
      expect(inputs).toHaveLength(3);

      expect(inputs[0]!.attributes("placeholder")).toBe("OG-Titel");
      expect(inputs[0]!.attributes("maxlength")).toBe("200");
      expect(inputs[0]!.classes()).not.toContain("mono");

      expect(inputs[1]!.attributes("placeholder")).toBe("OG-Beschreibung");
      expect(inputs[1]!.attributes("maxlength")).toBe("500");
      expect(inputs[1]!.classes()).not.toContain("mono");

      expect(inputs[2]!.attributes("placeholder")).toBe("Bild-URL");
      expect(inputs[2]!.attributes("maxlength")).toBe("2048");
      expect(inputs[2]!.classes()).toContain("mono");
    });

    it("renders the static hint line beneath the three inputs — no per-field character counter", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain()] },
      });

      await wrapper.find(".accordion-header--og").trigger("click");
      expect(wrapper.find(".og-hint").text()).toBe(
        "Social-Netzwerke zeigen typischerweise ca. 60 Zeichen Titel und ca. 155 Zeichen Beschreibung.",
      );
    });

    it("in edit mode the three inputs are pre-filled from the passed-in initial values", async () => {
      const wrapper = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          domainHostname: "s.meinefirma.de",
          initialTargetUrl: "https://example.com",
          initialSlug: "abc123",
          initialOgTitle: "Kampagnen-Titel",
          initialOgDescription: "Kampagnen-Beschreibung",
          initialOgImageUrl: "https://example.com/og.png",
        },
      });

      await wrapper.find(".accordion-header--og").trigger("click");
      const inputs = wrapper.findAll(".og-input");
      expect((inputs[0]!.element as HTMLInputElement).value).toBe("Kampagnen-Titel");
      expect((inputs[1]!.element as HTMLInputElement).value).toBe("Kampagnen-Beschreibung");
      expect((inputs[2]!.element as HTMLInputElement).value).toBe("https://example.com/og.png");
      expect(wrapper.find(".accordion-header--og").text()).toContain("· 3 gesetzt");
    });

    it("submitting an untouched form omits the three OG keys from the payload", async () => {
      const wrapper = mount(LinkFormModal, {
        props: { mode: "create", domains: [makeDomain({ id: "d2" })] },
      });

      await wrapper.find(".field-input.mono").setValue("https://example.com/x");
      await wrapper.find(".btn-primary").trigger("click");

      expect(wrapper.emitted("submit")![0]![0]).toMatchObject({
        ogTitle: undefined,
        ogDescription: undefined,
        ogImageUrl: undefined,
      });
    });

    it("submitting after clearing a pre-filled field sends that key as an explicit clear (null), and a typed value is sent as-is", async () => {
      const wrapper = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          domainHostname: "s.meinefirma.de",
          initialTargetUrl: "https://example.com",
          initialSlug: "abc123",
          initialOgTitle: "Kampagnen-Titel",
          initialOgDescription: "Kampagnen-Beschreibung",
        },
      });

      await wrapper.find(".accordion-header--og").trigger("click");
      const inputs = wrapper.findAll(".og-input");
      await inputs[0]!.setValue(""); // clear the pre-filled title
      await inputs[2]!.setValue("https://example.com/og.png"); // set the never-populated image url

      await wrapper.find(".btn-primary").trigger("click");

      expect(wrapper.emitted("submit")![0]![0]).toMatchObject({
        ogTitle: null,
        ogDescription: "Kampagnen-Beschreibung",
        ogImageUrl: "https://example.com/og.png",
      });
    });

    it("renders the locked OG-image-URL-invalid error beneath only the image-URL input", async () => {
      const wrapper = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          error: new ApiError(400, "Bad Request", "OG_IMAGE_URL_INVALID"),
        },
      });
      await wrapper.find(".accordion-header--og").trigger("click");

      const errors = wrapper.findAll(".accordion-body--og .field-error");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.text()).toBe(
        "Bitte eine vollständige Bild-URL mit http:// oder https:// angeben.",
      );
    });

    it("renders each locked too-long error beneath its own input", async () => {
      const wrapperTitle = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          error: new ApiError(400, "Bad Request", "OG_TITLE_TOO_LONG"),
        },
      });
      await wrapperTitle.find(".accordion-header--og").trigger("click");
      expect(wrapperTitle.findAll(".accordion-body--og .field-error")).toHaveLength(1);
      expect(wrapperTitle.find(".accordion-body--og .field-error").text()).toBe("Maximal 200 Zeichen.");

      const wrapperDesc = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          error: new ApiError(400, "Bad Request", "OG_DESCRIPTION_TOO_LONG"),
        },
      });
      await wrapperDesc.find(".accordion-header--og").trigger("click");
      expect(wrapperDesc.find(".accordion-body--og .field-error").text()).toBe("Maximal 500 Zeichen.");

      const wrapperImg = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          error: new ApiError(400, "Bad Request", "OG_IMAGE_URL_TOO_LONG"),
        },
      });
      await wrapperImg.find(".accordion-header--og").trigger("click");
      expect(wrapperImg.find(".accordion-body--og .field-error").text()).toBe("Maximal 2048 Zeichen.");
    });

    it("renders no OG field error for an unrelated error code", async () => {
      const wrapper = mount(LinkFormModal, {
        props: {
          mode: "edit",
          domains: [],
          error: new ApiError(409, "Conflict", "SLUG_TAKEN"),
        },
      });
      await wrapper.find(".accordion-header--og").trigger("click");
      expect(wrapper.find(".accordion-body--og .field-error").exists()).toBe(false);
    });
  });
});
