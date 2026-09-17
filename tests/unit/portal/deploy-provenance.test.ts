import { describe, expect, it } from "vitest";
import { resolveDeployCommitSha } from "../../../src/portal/deployProvenance.js";
import { assertAllowlistedAdminHost } from "../../../src/tah/write/targetLock.js";

describe("deploy provenance", () => {
  it("prefers baked image SHA over a leftover GIT_COMMIT_SHA pin", () => {
    expect(
      resolveDeployCommitSha({
        baked: "75e1c32e6b7a676e1f3b3829f2d8b286d21f7635",
        env: {
          GIT_COMMIT_SHA: "97ab093a0cd91554e2398ce68f2b83fe7f74f815",
          RAILWAY_GIT_COMMIT_SHA: "97ab093a0cd91554e2398ce68f2b83fe7f74f815",
        },
      }),
    ).toBe("75e1c32e6b7a676e1f3b3829f2d8b286d21f7635");
  });

  it("falls back to Railway git SHA when bake is missing", () => {
    expect(
      resolveDeployCommitSha({
        baked: "unknown",
        env: {
          RAILWAY_GIT_COMMIT_SHA: "abc123",
          GIT_COMMIT_SHA: "def456",
        },
      }),
    ).toBe("abc123");
  });
});

describe("live destination host lock", () => {
  it("fails closed when the logged-in page host is not the expected destination", () => {
    const lock = assertAllowlistedAdminHost({
      pageUrl: "https://veronipizza.dk/admin/menu",
      expectedHost: "bellakebab.dk",
      env: { PORTAL_LIVE_WRITE_HOSTS: "*" },
    });
    expect(lock.ok).toBe(false);
    if (!lock.ok) expect(lock.reason).toMatch(/wrong_host/);
  });

  it("passes when page host equals expected allowlisted destination", () => {
    const lock = assertAllowlistedAdminHost({
      pageUrl: "https://bellakebab.dk/admin/menu",
      expectedHost: "bellakebab.dk",
      env: { PORTAL_LIVE_WRITE_HOSTS: "*" },
    });
    expect(lock.ok).toBe(true);
  });
});
