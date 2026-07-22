/**
 * Unit tests for the QR web API client functions added to `api.ts` (Phase 7,
 * QR-02/03/04/07, 07-07-PLAN.md Task 1) — the SOLE fetch layer consumed by
 * `QrCodesView.vue` (this plan) and the two downstream frontend plans
 * (07-08 QR Studio, 07-09 Link-Detail entry point). No existing test in this
 * codebase stubs `global.fetch` directly against `api.ts` (prior view tests
 * mock the whole `../api` module instead) — this file establishes that
 * pattern for the QR client functions specifically, verifying the exact
 * method/URL/body each function sends and how it maps a failed response to
 * `ApiError`/`QrFormFieldErrors`.
 */
import type { QrCodeDTO, QrRemapHistoryEntryDTO } from "@kurzly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createQrCode,
  getQrRemapHistory,
  listQrCodes,
  mapQrFormError,
  qrRenderPngUrl,
  qrRenderSvgUrl,
  remapQrCode,
  updateQrCode,
} from "./api";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code?: string): Response {
  const body = code ? { error: code } : undefined;
  return new Response(body ? JSON.stringify(body) : undefined, { status });
}

describe("api.ts QR client functions", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createQrCode posts to /api/qr-codes and returns the created QrCodeDTO", async () => {
    const created = makeQrCode();
    fetchMock.mockResolvedValue(jsonResponse(created, 201));

    const result = await createQrCode({ variant: "dynamic", linkId: "l1", name: "Neuer QR-Code" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/qr-codes",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: "dynamic", linkId: "l1", name: "Neuer QR-Code" }),
      }),
    );
    expect(result).toEqual(created);
  });

  it("listQrCodes GETs /api/qr-codes and returns the array", async () => {
    const list = [makeQrCode({ id: "qr1" }), makeQrCode({ id: "qr2", variant: "static", code: null })];
    fetchMock.mockResolvedValue(jsonResponse(list));

    const result = await listQrCodes();

    expect(fetchMock).toHaveBeenCalledWith("/api/qr-codes", { method: "GET" });
    expect(result).toEqual(list);
  });

  it("updateQrCode PATCHes style fields only", async () => {
    const updated = makeQrCode({ color: "#1e3a5f" });
    fetchMock.mockResolvedValue(jsonResponse(updated));

    const result = await updateQrCode("qr1", { color: "#1e3a5f" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/qr-codes/qr1",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: "#1e3a5f" }),
      }),
    );
    expect(result).toEqual(updated);
  });

  it("remapQrCode PATCHes only targetLinkId, never combined with style fields", async () => {
    const remapped = makeQrCode({ linkId: "l2" });
    fetchMock.mockResolvedValue(jsonResponse(remapped));

    const result = await remapQrCode("qr1", "l2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/qr-codes/qr1",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLinkId: "l2" }),
      }),
    );
    expect(result).toEqual(remapped);
  });

  it("getQrRemapHistory GETs /api/qr-codes/:id/remap-history", async () => {
    const history: QrRemapHistoryEntryDTO[] = [
      { id: "h1", qrCodeId: "qr1", fromLinkId: "l1", toLinkId: "l2", createdAt: "2026-07-21T00:00:00.000Z" },
    ];
    fetchMock.mockResolvedValue(jsonResponse(history));

    const result = await getQrRemapHistory("qr1");

    expect(fetchMock).toHaveBeenCalledWith("/api/qr-codes/qr1/remap-history", { method: "GET" });
    expect(result).toEqual(history);
  });

  it("a failed call throws ApiError carrying status + parsed code", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "NOT_FOUND"));

    await expect(listQrCodes()).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("qrRenderPngUrl/qrRenderSvgUrl build the server render endpoint URLs (no client-side redraw)", () => {
    expect(qrRenderPngUrl("qr1")).toBe("/api/qr-codes/qr1/render.png");
    expect(qrRenderSvgUrl("qr1")).toBe("/api/qr-codes/qr1/render.svg");
  });
});

describe("mapQrFormError", () => {
  it("returns {} for a non-ApiError", () => {
    expect(mapQrFormError(new Error("network down"))).toEqual({});
  });

  it("maps 429 to the locked rate-limit message regardless of code", () => {
    const err = new ApiError(429, "Too Many Requests");
    expect(mapQrFormError(err)).toEqual({
      generalError: "Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst.",
    });
  });

  it("maps INVALID_LOGO to a logoError", () => {
    const err = new ApiError(400, "Bad Request", "INVALID_LOGO");
    expect(mapQrFormError(err)).toEqual({
      logoError: "Logo-Upload fehlgeschlagen. Bitte erneut versuchen.",
    });
  });

  it("maps NOT_DYNAMIC/CODE_GENERATION_EXHAUSTED/UNAUTHORIZED_DOMAIN to a generalError", () => {
    for (const code of ["NOT_DYNAMIC", "CODE_GENERATION_EXHAUSTED", "UNAUTHORIZED_DOMAIN"]) {
      const err = new ApiError(400, "Bad Request", code);
      expect(mapQrFormError(err)).toEqual({
        generalError: "Speichern fehlgeschlagen. Bitte erneut versuchen.",
      });
    }
  });

  it("falls back to {} for an unrecognized code/status combination", () => {
    const err = new ApiError(500, "Internal Server Error");
    expect(mapQrFormError(err)).toEqual({});
  });
});
