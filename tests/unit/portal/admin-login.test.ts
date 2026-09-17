import { describe, expect, it } from "vitest";
import { classifyLoginOutcome } from "../../../src/portal/adminLogin.js";
import { assertAllowlistedAdminHost } from "../../../src/tah/write/targetLock.js";

const base = {
  passwordVisible: true,
  adminEvidence: false,
  visibleError: null as string | null,
  cookieBlocked: false,
  networkFailure: false,
  formContractOk: true,
  sawAdminNavigation: false,
  loginPostStatus: null as number | null,
};

describe("classifyLoginOutcome", () => {
  it("returns LOGIN_OK for authenticated admin route without password field", () => {
    expect(
      classifyLoginOutcome({
        ...base,
        finalUrl: "https://example.dk/admin",
        passwordVisible: false,
        adminEvidence: true,
      }),
    ).toBe("LOGIN_OK");
  });

  it("returns CREDENTIALS_REJECTED when visible auth error remains on /login", () => {
    expect(
      classifyLoginOutcome({
        ...base,
        finalUrl: "https://example.dk/login",
        visibleError: "These credentials do not match our records.",
      }),
    ).toBe("CREDENTIALS_REJECTED");
  });

  it("returns CREDENTIALS_REJECTED on 422 login POST", () => {
    expect(
      classifyLoginOutcome({
        ...base,
        finalUrl: "https://example.dk/login",
        loginPostStatus: 422,
      }),
    ).toBe("CREDENTIALS_REJECTED");
  });

  it("returns COOKIE_OR_OVERLAY_BLOCKED when the banner remains", () => {
    expect(
      classifyLoginOutcome({
        ...base,
        finalUrl: "https://example.dk/login",
        cookieBlocked: true,
      }),
    ).toBe("COOKIE_OR_OVERLAY_BLOCKED");
  });

  it("returns LOGIN_FORM_CONTRACT_CHANGED when email/password/submit are missing", () => {
    expect(
      classifyLoginOutcome({
        ...base,
        finalUrl: "https://example.dk/login",
        formContractOk: false,
      }),
    ).toBe("LOGIN_FORM_CONTRACT_CHANGED");
  });

  it("returns REDIRECT_OR_SESSION_FAILURE after /admin then bounce to /login", () => {
    expect(
      classifyLoginOutcome({
        ...base,
        finalUrl: "https://example.dk/login",
        sawAdminNavigation: true,
        loginPostStatus: 302,
      }),
    ).toBe("REDIRECT_OR_SESSION_FAILURE");
  });

  it("returns NETWORK_OR_TLS_FAILURE on transport errors", () => {
    expect(
      classifyLoginOutcome({
        ...base,
        finalUrl: "https://example.dk/login",
        networkFailure: true,
      }),
    ).toBe("NETWORK_OR_TLS_FAILURE");
  });

  it("returns UNKNOWN_LOGIN_FAILURE when still on /login without error text", () => {
    expect(
      classifyLoginOutcome({
        ...base,
        finalUrl: "https://example.dk/login",
      }),
    ).toBe("UNKNOWN_LOGIN_FAILURE");
  });
});

describe("admin host lock after login", () => {
  it("accepts /admin without a trailing slash", () => {
    const lock = assertAllowlistedAdminHost({
      pageUrl: "https://bellakebab.dk/admin",
      expectedHost: "bellakebab.dk",
      env: { PORTAL_LIVE_WRITE_HOSTS: "*" },
    });
    expect(lock.ok).toBe(true);
  });
});
