/**
 * Component test for QrStudioPanel (07-UI-SPEC.md Surface A Studio column,
 * QR-01/05/06) — mocks `../api` (mirrors QrCodesView.test.ts's `vi.mock`
 * pattern). Debounce assertions wait out the REAL 300ms timer (matching
 * LinksView.test.ts's WR-08 search-debounce convention/comment: real
 * timers avoid entangling with `@vue/test-utils`' `flushPromises`, which
 * itself uses a real `setTimeout(0)` internally — `vi.useFakeTimers()`
 * would fight that).
 *
 * `new Image()` (used by the component to preload the next server render
 * before swapping the visible `<img>`'s `src`, so the previous frame stays
 * on screen at opacity .6 until the new one is ready — 07-UI-SPEC.md's "no
 * skeleton, previous image stays visible" rule) is stubbed globally: jsdom
 * never actually loads image bytes, so a real `Image` would never fire
 * `onload`.
 */
import { flushPromises, mount } from "@vue/test-utils";
import type { QrCodeDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QrStudioPanel from "./QrStudioPanel.vue";
import { ApiError } from "../api";

const { fetchQrRenderBlob, updateQrCode } = vi.hoisted(() => ({
  fetchQrRenderBlob: vi.fn(),
  updateQrCode: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, fetchQrRenderBlob, updateQrCode };
});

/** jsdom-safe stand-in for the browser `Image` preloader — resolves `onload` on the next microtask. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  set src(value: string) {
    this._src = value;
    Promise.resolve().then(() => this.onload?.());
  }
  get src(): string {
    return this._src;
  }
}

function makeQrCode(overrides: Partial<QrCodeDTO> = {}): QrCodeDTO {
  return {
    id: "qr1",
    variant: "dynamic",
    linkId: "l1",
    code: "abc1234",
    name: "Neuer QR-Code",
    color: "#17170f",
    roundedModules: false,
    logoEnabled: false,
    lifetimeScans: 0,
    createdBy: "u1",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

/** Waits past the 300ms render debounce + the FakeImage's onload microtask (real timers, per file header). */
async function waitOutDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await flushPromises();
}

beforeEach(() => {
  fetchQrRenderBlob.mockReset();
  updateQrCode.mockReset();
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountPanel(qr: QrCodeDTO) {
  return mount(QrStudioPanel, { props: { qr } });
}

describe("QrStudioPanel", () => {
  it("renders a preview <img> pointing at the server render.png endpoint", () => {
    const wrapper = mountPanel(makeQrCode());
    const img = wrapper.find("img.preview-image");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toContain("/api/qr-codes/qr1/render.png");
  });

  it("clicking a color swatch persists via updateQrCode and refreshes the preview after the debounce", async () => {
    updateQrCode.mockResolvedValue(makeQrCode({ color: "#1e3a5f" }));
    const wrapper = mountPanel(makeQrCode());

    const swatches = wrapper.findAll(".color-swatch");
    await swatches[1]!.trigger("click"); // #1e3a5f

    expect(updateQrCode).toHaveBeenCalledWith("qr1", { color: "#1e3a5f" });

    const srcBefore = wrapper.find("img.preview-image").attributes("src");
    await waitOutDebounce();
    const srcAfter = wrapper.find("img.preview-image").attributes("src");
    expect(srcAfter).not.toBe(srcBefore);
  });

  it("toggling 'Runde Module' persists roundedModules via updateQrCode", async () => {
    updateQrCode.mockResolvedValue(makeQrCode({ roundedModules: true }));
    const wrapper = mountPanel(makeQrCode());

    await wrapper.find(".rounded-toggle").trigger("click");

    expect(updateQrCode).toHaveBeenCalledWith("qr1", { roundedModules: true });
  });

  it("toggling 'Logo in der Mitte' persists logoEnabled via updateQrCode", async () => {
    updateQrCode.mockResolvedValue(makeQrCode({ logoEnabled: true }));
    const wrapper = mountPanel(makeQrCode());

    await wrapper.find(".logo-toggle").trigger("click");

    expect(updateQrCode).toHaveBeenCalledWith("qr1", { logoEnabled: true });
  });

  it("reverts the toggle and does not crash when updateQrCode fails", async () => {
    updateQrCode.mockRejectedValue(new ApiError(500, "Internal Server Error"));
    const wrapper = mountPanel(makeQrCode());

    await wrapper.find(".logo-toggle").trigger("click");
    await flushPromises();

    expect(wrapper.find(".logo-toggle").classes()).not.toContain("active");
    expect(wrapper.emitted("toast")).toBeTruthy();
  });

  it("shows the BRAND_NAME-initial placeholder overlay once the logo toggle is on with no upload", async () => {
    updateQrCode.mockResolvedValue(makeQrCode({ logoEnabled: true }));
    const wrapper = mountPanel(makeQrCode());

    await wrapper.find(".logo-toggle").trigger("click");
    await flushPromises();

    expect(wrapper.find(".logo-overlay").exists()).toBe(true);
  });

  it("rejects an oversized logo file inline and never calls updateQrCode", async () => {
    const wrapper = mountPanel(makeQrCode());
    const bigFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" });
    const input = wrapper.find("input[type='file']");
    Object.defineProperty(input.element, "files", { value: [bigFile], configurable: true });

    await input.trigger("change");
    await flushPromises();

    expect(wrapper.text()).toContain("Datei zu groß (max. 1,4 MB).");
    expect(updateQrCode).not.toHaveBeenCalled();
  });

  /**
   * WR-03 regression: the server caps `logoData` at 1,900,000 base64 chars
   * (~1,425,000 raw bytes). A file in the old ~1.36-2.00 MiB gap passed the
   * client check and then failed server-side with an untyped 400, which
   * `mapQrFormError` funnels into the generic "Speichern fehlgeschlagen"
   * toast — for a file the UI had just declared to be within limits. The
   * client cap must therefore sit BELOW the server's, not above it.
   */
  it("rejects a logo file inside the old client/server gap (1.5 MiB) before any request is made", async () => {
    const wrapper = mountPanel(makeQrCode());
    const gapFile = new File([new Uint8Array(1_500_000)], "logo.png", { type: "image/png" });
    const input = wrapper.find("input[type='file']");
    Object.defineProperty(input.element, "files", { value: [gapFile], configurable: true });

    await input.trigger("change");
    await flushPromises();

    expect(wrapper.text()).toContain("Datei zu groß (max. 1,4 MB).");
    expect(updateQrCode).not.toHaveBeenCalled();
  });

  it("rejects a non-PNG/SVG logo file inline and never calls updateQrCode", async () => {
    const wrapper = mountPanel(makeQrCode());
    const badFile = new File(["not-an-image"], "logo.gif", { type: "image/gif" });
    const input = wrapper.find("input[type='file']");
    Object.defineProperty(input.element, "files", { value: [badFile], configurable: true });

    await input.trigger("change");
    await flushPromises();

    expect(wrapper.text()).toContain("Nur PNG oder SVG erlaubt.");
    expect(updateQrCode).not.toHaveBeenCalled();
  });

  it("uploads a valid PNG logo as base64, auto-enables the toggle, and shows the filename chip", async () => {
    updateQrCode.mockResolvedValue(makeQrCode({ logoEnabled: true }));
    const wrapper = mountPanel(makeQrCode());
    const file = new File(["fake-png-bytes"], "logo.png", { type: "image/png" });
    const input = wrapper.find("input[type='file']");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });

    await input.trigger("change");
    // FileReader.readAsDataURL resolves asynchronously — wait it out.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushPromises();

    expect(updateQrCode).toHaveBeenCalledWith(
      "qr1",
      expect.objectContaining({ logoEnabled: true, logoData: expect.stringContaining("base64") }),
    );
    expect(wrapper.find(".file-chip-name").text()).toBe("logo.png");
  });

  /**
   * WR-04 regression: `readAsDataUrl` rejects on `reader.onerror`, but the
   * call sat OUTSIDE `handleLogoFile`'s try block. Since the change handler
   * invokes it as `void handleLogoFile(file)`, the rejection escaped as an
   * unhandled promise rejection and the user saw nothing at all —
   * `logoError` stayed null and no toast fired.
   */
  it("surfaces an inline error (and no unhandled rejection) when FileReader fails", async () => {
    class FailingFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      error = new Error("read failed");
      result: string | null = null;
      readAsDataURL(): void {
        Promise.resolve().then(() => this.onerror?.());
      }
    }
    vi.stubGlobal("FileReader", FailingFileReader);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const wrapper = mountPanel(makeQrCode());
    const file = new File(["fake-png-bytes"], "logo.png", { type: "image/png" });
    const input = wrapper.find("input[type='file']");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });

    await input.trigger("change");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushPromises();

    expect(wrapper.find(".logo-error").text()).toBe("Nur PNG oder SVG erlaubt.");
    expect(updateQrCode).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  /**
   * WR-08 regression: `removeLogo` used to send only `{ logoData: null }`,
   * leaving `logoEnabled` true server-side — which silently dropped the
   * error-correction level from H back to M — while the client reset
   * `hasCustomLogo`, flipping the decorative placeholder tile back on. The
   * user then saw a logo in the preview that the exported bytes did not
   * contain. Both fields must be cleared together, mirroring the upload
   * path's symmetry.
   */
  it("'Logo entfernen' clears BOTH logoData and logoEnabled, and hides the placeholder tile", async () => {
    updateQrCode.mockResolvedValue(makeQrCode({ logoEnabled: true }));
    const wrapper = mountPanel(makeQrCode());
    const file = new File(["fake-png-bytes"], "logo.png", { type: "image/png" });
    const input = wrapper.find("input[type='file']");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushPromises();

    updateQrCode.mockClear();
    updateQrCode.mockResolvedValue(makeQrCode({ logoEnabled: false }));

    await wrapper.find(".file-chip-remove").trigger("click");
    await flushPromises();

    expect(updateQrCode).toHaveBeenCalledWith("qr1", { logoData: null, logoEnabled: false });
    expect(wrapper.find(".file-chip").exists()).toBe(false);
    // No stored logo AND the toggle is off -> nothing may suggest a logo.
    expect(wrapper.find(".logo-overlay").exists()).toBe(false);
  });

  it("clicking 'PNG ⬇' fetches the PNG blob and triggers a browser download", async () => {
    const blob = new Blob(["fake-png"], { type: "image/png" });
    fetchQrRenderBlob.mockResolvedValue(blob);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const wrapper = mountPanel(makeQrCode());

    await wrapper.find(".export-png").trigger("click");
    await flushPromises();

    expect(fetchQrRenderBlob).toHaveBeenCalledWith("qr1", "png");
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("clicking 'SVG ⬇' fetches the SVG blob and triggers a browser download", async () => {
    const blob = new Blob(["<svg/>"], { type: "image/svg+xml" });
    fetchQrRenderBlob.mockResolvedValue(blob);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const wrapper = mountPanel(makeQrCode());

    await wrapper.find(".export-svg").trigger("click");
    await flushPromises();

    expect(fetchQrRenderBlob).toHaveBeenCalledWith("qr1", "svg");
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("toasts 'Export fehlgeschlagen. Bitte erneut versuchen.' when the export fetch fails", async () => {
    fetchQrRenderBlob.mockRejectedValue(new ApiError(500, "Internal Server Error"));
    const wrapper = mountPanel(makeQrCode());

    await wrapper.find(".export-png").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("toast")?.[0]).toEqual(["Export fehlgeschlagen. Bitte erneut versuchen."]);
  });
});
