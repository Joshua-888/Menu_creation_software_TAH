import { describe, expect, it } from "vitest";
import {
  parseLiveWriteHostAllowlist,
  isHostAllowlistedForLiveWrites,
  normalizeDestinationHost,
} from "../../src/tah/write/hostAllowlist.js";
import { shouldSeedDefaultTilbehor } from "../../src/learning/structurePolicy.js";
import { shouldApplyPeerProbabilityPolicy } from "../../src/learning/peerArtifacts.js";
import { shouldLoadLiveDestinationForDryRun } from "../../src/portal/liveExecute.js";
import { shouldCreateProductsHidden } from "../../src/planning/dryRun.js";
import { isStructureWriteConfirmed } from "../../src/portal/structureWriteGate.js";
import { evaluatePortalLiveWriteGate } from "../../src/portal/liveWrites.js";

describe("multi-merchant host allowlist", () => {
  it("defaults to veronipizza.dk", () => {
    expect(parseLiveWriteHostAllowlist({})).toEqual(["veronipizza.dk"]);
  });

  it("merges PORTAL_LIVE_WRITE_HOSTS with default unless STRICT", () => {
    const env = {
      PORTAL_LIVE_WRITE_HOSTS: "shop-a.dk, https://www.shop-b.dk",
    } as NodeJS.ProcessEnv;
    expect(parseLiveWriteHostAllowlist(env)).toEqual([
      "shop-a.dk",
      "shop-b.dk",
      "veronipizza.dk",
    ]);
    expect(
      isHostAllowlistedForLiveWrites("https://shop-a.dk/admin/menu", env),
    ).toBe(true);
  });

  it("STRICT drops automatic Veroni default", () => {
    const env = {
      PORTAL_LIVE_WRITE_HOSTS: "shop-a.dk,shop-b.dk",
      PORTAL_LIVE_WRITE_HOSTS_STRICT: "1",
    } as NodeJS.ProcessEnv;
    expect(parseLiveWriteHostAllowlist(env)).toEqual([
      "shop-a.dk",
      "shop-b.dk",
    ]);
    expect(isHostAllowlistedForLiveWrites("veronipizza.dk", env)).toBe(false);
  });

  it("opens live gate for allowlisted new merchants", () => {
    const gated = evaluatePortalLiveWriteGate({
      destinationHost: "shop-a.dk",
      env: {
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
        PORTAL_LIVE_WRITE_HOSTS: "shop-a.dk,shop-b.dk",
        PORTAL_LIVE_WRITE_HOSTS_STRICT: "1",
      },
    });
    expect(gated.canLiveExecute).toBe(true);
    expect(gated.allowlist).toEqual(["shop-a.dk", "shop-b.dk"]);
  });

  it("normalizes www and URLs", () => {
    expect(normalizeDestinationHost("https://www.Shop-A.dk/path")).toBe(
      "shop-a.dk",
    );
  });
});

describe("default Tilbehør seed scoping", () => {
  it("seeds Veroni only by default", () => {
    const prev = process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
    delete process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
    try {
      expect(shouldSeedDefaultTilbehor("veronipizza.dk")).toBe(true);
      expect(shouldSeedDefaultTilbehor("shop-a.dk")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
      else process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = prev;
    }
  });

  it("allows explicit extra hosts via env", () => {
    const prev = process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
    process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = "shop-a.dk";
    try {
      expect(shouldSeedDefaultTilbehor("shop-a.dk")).toBe(true);
      expect(shouldSeedDefaultTilbehor("shop-b.dk")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
      else process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = prev;
    }
  });
});

describe("dry-run live destination gate", () => {
  it("turns on with credentials + allowlist; kill switch forces off", () => {
    expect(
      shouldLoadLiveDestinationForDryRun("shop-a.dk", {
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
        PORTAL_LIVE_WRITE_HOSTS: "shop-a.dk",
        PORTAL_LIVE_WRITE_HOSTS_STRICT: "1",
      }),
    ).toBe(true);
    expect(
      shouldLoadLiveDestinationForDryRun("shop-a.dk", {
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
        PORTAL_LIVE_WRITE_HOSTS: "other.dk",
        PORTAL_LIVE_WRITE_HOSTS_STRICT: "1",
      }),
    ).toBe(false);
    expect(
      shouldLoadLiveDestinationForDryRun("shop-a.dk", {
        PORTAL_DRYRUN_LIVE_DEST: "0",
        TAH_ADMIN_EMAIL: "a@b.c",
        TAH_ADMIN_PASSWORD: "x",
        PORTAL_LIVE_WRITE_HOSTS: "shop-a.dk",
        PORTAL_LIVE_WRITE_HOSTS_STRICT: "1",
      }),
    ).toBe(false);
    expect(
      shouldLoadLiveDestinationForDryRun("shop-a.dk", {
        PORTAL_LIVE_WRITE_HOSTS: "shop-a.dk",
      }),
    ).toBe(false);
  });
});

describe("storefront publish default", () => {
  it("publishes by default; PORTAL_CREATE_HIDDEN keeps Skjult", () => {
    expect(shouldCreateProductsHidden({})).toBe(false);
    expect(
      shouldCreateProductsHidden({ PORTAL_CREATE_HIDDEN: "1" }),
    ).toBe(true);
    expect(
      shouldCreateProductsHidden({ PORTAL_STOREFRONT_PUBLISH: "0" }),
    ).toBe(true);
  });
});

describe("structure write confirm env", () => {
  it("requires STRUCTURE_WRITE_FINGERPRINT when CONFIRMED=1", () => {
    const missing = isStructureWriteConfirmed({
      restaurantKey: "shop-a.dk",
      fingerprint: "abc",
      env: { STRUCTURE_WRITE_CONFIRMED: "1" },
    });
    expect(missing.ok).toBe(false);
    expect(missing.blockers[0]).toMatch(/STRUCTURE_WRITE_FINGERPRINT/);

    const ok = isStructureWriteConfirmed({
      restaurantKey: "shop-a.dk",
      fingerprint: "abc",
      env: {
        STRUCTURE_WRITE_CONFIRMED: "1",
        STRUCTURE_WRITE_FINGERPRINT: "abc",
      },
    });
    expect(ok.ok).toBe(true);
  });
});

describe("peer probability scoping", () => {
  it("applies to Veroni by default, not new merchants", () => {
    expect(shouldApplyPeerProbabilityPolicy("veronipizza.dk", {})).toBe(true);
    expect(shouldApplyPeerProbabilityPolicy("shop-a.dk", {})).toBe(false);
  });

  it("opts in hosts via PORTAL_APPLY_PEER_PROBABILITY_HOSTS", () => {
    expect(
      shouldApplyPeerProbabilityPolicy("shop-a.dk", {
        PORTAL_APPLY_PEER_PROBABILITY_HOSTS: "shop-a.dk",
      }),
    ).toBe(true);
  });

  it("applies to all when PORTAL_APPLY_PEER_PROBABILITY=1", () => {
    expect(
      shouldApplyPeerProbabilityPolicy("shop-b.dk", {
        PORTAL_APPLY_PEER_PROBABILITY: "1",
      }),
    ).toBe(true);
  });
});
