/**
 * Component test for DomainsView (DOMAIN-01/02/04 UI, 03-UI-SPEC.md).
 * Mocks the `../src/api` module (mirrors LoginView.test.ts's `vi.mock`
 * pattern) — no real network happens; see 03-01/03-02's integration
 * coverage for the actual server-side behavior.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { DomainDTO } from "@zack/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DomainsView from "../src/views/DomainsView.vue";
import { ApiError } from "../src/api";

const { createDomain, listDomains, verifyDomain, deleteDomain, getDomainInstructions } =
  vi.hoisted(() => ({
    createDomain: vi.fn(),
    listDomains: vi.fn(),
    verifyDomain: vi.fn(),
    deleteDomain: vi.fn(),
    getDomainInstructions: vi.fn(),
  }));

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    createDomain,
    listDomains,
    verifyDomain,
    deleteDomain,
    getDomainInstructions,
  };
});

function makeDomain(overrides: Partial<DomainDTO> = {}): DomainDTO {
  return {
    id: "d1",
    hostname: "s.meinefirma.de",
    type: "subdomain",
    status: "pending",
    verifiedAt: null,
    lastCheckedAt: null,
    lastCheckError: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  createDomain.mockReset();
  listDomains.mockReset();
  verifyDomain.mockReset();
  deleteDomain.mockReset();
  getDomainInstructions.mockReset();
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DomainsView", () => {
  it("renders the empty state when listDomains resolves to []", async () => {
    listDomains.mockResolvedValueOnce([]);

    const wrapper = mount(DomainsView);
    await flushPromises();

    expect(wrapper.text()).toContain("Noch keine Domain registriert");
    expect(wrapper.find(".domain-list").exists()).toBe(false);
  });

  it("renders each domain's hostname, type badge, and status badge label", async () => {
    listDomains.mockResolvedValueOnce([
      makeDomain({ id: "d1", hostname: "s.meinefirma.de", type: "subdomain", status: "active" }),
      makeDomain({ id: "d2", hostname: "meinefirma.de", type: "apex", status: "pending" }),
      makeDomain({ id: "d3", hostname: "bad.meinefirma.de", type: "subdomain", status: "failed" }),
    ]);

    const wrapper = mount(DomainsView);
    await flushPromises();

    const rows = wrapper.findAll(".domain-row");
    expect(rows).toHaveLength(3);

    expect(rows[0]!.text()).toContain("s.meinefirma.de");
    expect(rows[0]!.text()).toContain("SUBDOMAIN");
    expect(rows[0]!.text()).toContain("Aktiv");

    expect(rows[1]!.text()).toContain("meinefirma.de");
    expect(rows[1]!.text()).toContain("APEX");
    expect(rows[1]!.text()).toContain("DNS ausstehend");

    expect(rows[2]!.text()).toContain("bad.meinefirma.de");
    expect(rows[2]!.text()).toContain("Fehlgeschlagen");
  });

  it("adding a domain calls createDomain with { hostname, type } and appends the new pending row + shows a toast", async () => {
    listDomains.mockResolvedValueOnce([]);
    createDomain.mockResolvedValueOnce(
      makeDomain({ id: "new1", hostname: "s.neu.de", type: "subdomain", status: "pending" }),
    );

    const wrapper = mount(DomainsView);
    await flushPromises();

    await wrapper.find(".domain-input").setValue("s.neu.de");
    await wrapper.find(".add-button").trigger("click");
    await flushPromises();

    expect(createDomain).toHaveBeenCalledWith({ hostname: "s.neu.de", type: "subdomain" });
    expect(wrapper.find(".domain-row").exists()).toBe(true);
    expect(wrapper.text()).toContain("s.neu.de");
    expect(wrapper.find(".toast").exists()).toBe(true);
    expect(wrapper.find(".toast").text()).toBe("s.neu.de hinzugefügt — DNS ausstehend");
  });

  it("clicking 'Jetzt prüfen' calls verifyDomain and updates the badge to Aktiv on a resolved active result", async () => {
    listDomains.mockResolvedValueOnce([
      makeDomain({ id: "d1", hostname: "s.meinefirma.de", status: "pending" }),
    ]);
    verifyDomain.mockResolvedValueOnce(
      makeDomain({
        id: "d1",
        hostname: "s.meinefirma.de",
        status: "active",
        verifiedAt: "2026-07-11T12:00:00.000Z",
        lastCheckedAt: "2026-07-11T12:00:00.000Z",
      }),
    );

    const wrapper = mount(DomainsView);
    await flushPromises();

    expect(wrapper.text()).toContain("DNS ausstehend");
    await wrapper.find(".verify-button").trigger("click");
    await flushPromises();

    expect(verifyDomain).toHaveBeenCalledWith("d1");
    expect(wrapper.find(".status-badge.active").exists()).toBe(true);
    expect(wrapper.find(".status-badge.active").text()).toBe("Aktiv");
    expect(wrapper.find(".verify-button").exists()).toBe(false);
  });

  it("toggling the instructions accordion calls getDomainInstructions and renders the record + a copy button", async () => {
    listDomains.mockResolvedValueOnce([
      makeDomain({ id: "d1", hostname: "s.meinefirma.de", type: "subdomain" }),
    ]);
    getDomainInstructions.mockResolvedValueOnce({
      hostname: "s.meinefirma.de",
      type: "subdomain",
      verificationTarget: "shortener.kurzly.local",
      instructions: "s.meinefirma.de.  300  IN  CNAME  shortener.kurzly.local.",
      alternativeForApex: null,
    });

    const wrapper = mount(DomainsView);
    await flushPromises();

    await wrapper.find(".instructions-toggle").trigger("click");
    await flushPromises();

    expect(getDomainInstructions).toHaveBeenCalledWith("d1");
    expect(wrapper.find(".instructions-panel").exists()).toBe(true);
    expect(wrapper.find(".dns-code-block code").text()).toBe(
      "s.meinefirma.de.  300  IN  CNAME  shortener.kurzly.local.",
    );
    expect(wrapper.find(".copy-button").exists()).toBe(true);
    expect(wrapper.text()).toContain("nicht Kurzly");
  });

  it("the delete icon opens the confirmation dialog and does NOT call deleteDomain until confirmed", async () => {
    listDomains.mockResolvedValueOnce([
      makeDomain({ id: "d1", hostname: "s.meinefirma.de" }),
    ]);
    deleteDomain.mockResolvedValueOnce(undefined);

    const wrapper = mount(DomainsView);
    await flushPromises();

    await wrapper.find(".delete-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".delete-dialog").exists()).toBe(true);
    expect(wrapper.text()).toContain("Domain entfernen?");
    expect(deleteDomain).not.toHaveBeenCalled();

    await wrapper.find(".delete-confirm-button").trigger("click");
    await flushPromises();

    expect(deleteDomain).toHaveBeenCalledWith("d1");
    expect(wrapper.find(".delete-dialog").exists()).toBe(false);
    expect(wrapper.find(".domain-row").exists()).toBe(false);
  });

  it("clicking 'Abbrechen' closes the confirmation dialog without deleting", async () => {
    listDomains.mockResolvedValueOnce([
      makeDomain({ id: "d1", hostname: "s.meinefirma.de" }),
    ]);

    const wrapper = mount(DomainsView);
    await flushPromises();

    await wrapper.find(".delete-button").trigger("click");
    await flushPromises();
    await wrapper.find(".cancel-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".delete-dialog").exists()).toBe(false);
    expect(deleteDomain).not.toHaveBeenCalled();
    expect(wrapper.find(".domain-row").exists()).toBe(true);
  });

  it("maps a 409 createDomain error to the duplicate-domain copy", async () => {
    listDomains.mockResolvedValueOnce([]);
    createDomain.mockRejectedValueOnce(new ApiError(409, "Conflict"));

    const wrapper = mount(DomainsView);
    await flushPromises();

    await wrapper.find(".domain-input").setValue("dupe.de");
    await wrapper.find(".add-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".toast").text()).toBe("Diese Domain ist bereits registriert.");
  });
});
