/**
 * Unit tests for the five Phase 8 UTM/OG error codes `mapLinkFormError`
 * gained in this plan (08-04 Task 2, META-01/02, 08-UI-SPEC.md Copywriting
 * Contract) — mirrors api.qr.test.ts's pattern of constructing `ApiError`
 * instances directly. The pre-existing `mapLinkFormError` describe block
 * (target-url/slug codes, the status-only fallback, the non-ApiError case)
 * stays in LinkFormModal.test.ts unchanged and is NOT duplicated here.
 */
import { describe, expect, it } from "vitest";
import { ApiError, mapLinkFormError } from "./api";

describe("mapLinkFormError — Phase 8 UTM/OG codes", () => {
  it("maps a 400 UTM_VALUE_TOO_LONG ApiError to the locked UTM length message on utmError", () => {
    expect(mapLinkFormError(new ApiError(400, "Bad Request", "UTM_VALUE_TOO_LONG"))).toEqual({
      utmError: "Maximal 200 Zeichen pro UTM-Wert.",
    });
  });

  it("maps a 400 OG_TITLE_TOO_LONG ApiError to the locked title length message on ogTitleError", () => {
    expect(mapLinkFormError(new ApiError(400, "Bad Request", "OG_TITLE_TOO_LONG"))).toEqual({
      ogTitleError: "Maximal 200 Zeichen.",
    });
  });

  it("maps a 400 OG_DESCRIPTION_TOO_LONG ApiError to the locked description length message on ogDescriptionError", () => {
    expect(mapLinkFormError(new ApiError(400, "Bad Request", "OG_DESCRIPTION_TOO_LONG"))).toEqual({
      ogDescriptionError: "Maximal 500 Zeichen.",
    });
  });

  it("maps a 400 OG_IMAGE_URL_TOO_LONG ApiError to the locked image-URL length message on ogImageUrlError", () => {
    expect(mapLinkFormError(new ApiError(400, "Bad Request", "OG_IMAGE_URL_TOO_LONG"))).toEqual({
      ogImageUrlError: "Maximal 2048 Zeichen.",
    });
  });

  it("maps a 400 OG_IMAGE_URL_INVALID ApiError to the locked scheme message on ogImageUrlError — distinct from the length message", () => {
    const result = mapLinkFormError(new ApiError(400, "Bad Request", "OG_IMAGE_URL_INVALID"));
    expect(result).toEqual({
      ogImageUrlError: "Bitte eine vollständige Bild-URL mit http:// oder https:// angeben.",
    });
    expect(result.ogImageUrlError).not.toBe("Maximal 2048 Zeichen.");
  });

  it("leaves the existing target-url/slug mappings and the non-ApiError case unaffected", () => {
    expect(mapLinkFormError(new ApiError(400, "Bad Request", "INVALID_TARGET_URL"))).toEqual({
      targetUrlError: "Das sieht nicht wie eine gültige URL aus (https://…).",
    });
    expect(mapLinkFormError(new Error("boom"))).toEqual({});
  });
});
