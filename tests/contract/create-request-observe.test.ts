import { describe, expect, it } from "vitest";
import { ErrorCategory } from "../../src/domain/errors.js";
import { isProductCreateRequest } from "../../src/tah/write/createRequestObserve.js";

describe("submit interactability + create request observation", () => {
  it("includes overlay and create observation error codes", () => {
    expect(ErrorCategory).toContain("SUBMIT_CONTROL_BLOCKED_BY_OVERLAY");
    expect(ErrorCategory).toContain("SUBMIT_CONTROL_NOT_INTERACTABLE");
    expect(ErrorCategory).toContain("CREATE_REQUEST_NOT_OBSERVED");
  });

  it("matches POST /admin/menu without requiring postData (multipart-safe)", () => {
    const ok = {
      method: () => "POST",
      url: () => "https://veronipizza.dk/admin/menu",
      postData: () => null,
    };
    expect(isProductCreateRequest(ok as never)).toBe(true);
    expect(
      isProductCreateRequest({
        method: () => "POST",
        url: () => "https://veronipizza.dk/admin/menu/",
        postData: () => "",
      } as never),
    ).toBe(true);
  });

  it("rejects update path and non-POST", () => {
    expect(
      isProductCreateRequest({
        method: () => "POST",
        url: () => "https://veronipizza.dk/admin/menu/18",
        postData: () => null,
      } as never),
    ).toBe(false);
    expect(
      isProductCreateRequest({
        method: () => "GET",
        url: () => "https://veronipizza.dk/admin/menu",
        postData: () => null,
      } as never),
    ).toBe(false);
  });
});
