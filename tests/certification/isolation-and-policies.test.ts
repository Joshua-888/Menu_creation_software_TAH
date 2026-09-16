/**
 * Off-spine / merchant isolation + MENU_AS_VARIANT runtime count.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listPolicyLifecycle,
  MENU_AS_VARIANT_SUPERSESSION,
} from "../../src/intelligence/index.js";
import { mapResolutionToTransform } from "../../src/decisions/transforms.js";
import { tryDeterministicResolve } from "../../src/decisions/deterministic.js";

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkTsFiles(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("Off-spine Veroni / Smash isolation", () => {
  it("production src does not import golden fixtures or m6 scripts", () => {
    const root = join(process.cwd(), "src");
    const files = walkTsFiles(root);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (
        /from\s+["'].*fixtures\/golden/.test(text) ||
        /from\s+["'].*scripts\/m6/.test(text) ||
        /from\s+["'].*submit-smash/.test(text)
      ) {
        offenders.push(relative(process.cwd(), f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("portal/intelligence/planning do not import veroniAutonomousPass", () => {
    const dirs = ["src/portal", "src/intelligence", "src/planning"].map((d) =>
      join(process.cwd(), d),
    );
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const f of walkTsFiles(dir)) {
        const text = readFileSync(f, "utf8");
        if (/veroniAutonomousPass/.test(text)) {
          offenders.push(relative(process.cwd(), f));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("MENU_AS_VARIANT runtime", () => {
  it("lifecycle marks MENU_AS_VARIANT superseded", () => {
    expect(MENU_AS_VARIANT_SUPERSESSION.status).toBe("SUPERSEDED");
    expect(
      listPolicyLifecycle().find((p) => p.policyId === "MENU_AS_VARIANT")
        ?.status,
    ).toBe("SUPERSEDED");
  });

  it("deterministic MENU_PRICE maps away from MENU_AS_VARIANT", () => {
    expect(mapResolutionToTransform("MENU_AS_VARIANT", "variant")).toBe(
      "MENU_IS_COMBO_NOT_VARIANT",
    );
    expect(mapResolutionToTransform("MENU_IS_COMBO_NOT_VARIANT", "combo")).toBe(
      "MENU_IS_COMBO_NOT_VARIANT",
    );
    // Spot-check: deterministic module no longer returns MENU_AS_VARIANT string
    const src = readFileSync(
      join(process.cwd(), "src/decisions/deterministic.ts"),
      "utf8",
    );
    expect(src).toMatch(/MENU_IS_COMBO_NOT_VARIANT/);
    expect(src).not.toMatch(/resolution:\s*"MENU_AS_VARIANT"/);
    void tryDeterministicResolve;
  });

  it("active MENU_AS_VARIANT resolution count in intelligence/portal is 0", () => {
    const files = [
      ...walkTsFiles(join(process.cwd(), "src/intelligence")),
      ...walkTsFiles(join(process.cwd(), "src/portal")),
      ...walkTsFiles(join(process.cwd(), "src/planning")),
    ];
    let activeUses = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // Count affirmative resolution assignments, not SUPERSEDED comments
      const matches = text.match(
        /resolution:\s*["']MENU_AS_VARIANT["']|return\s+["']MENU_AS_VARIANT["']/g,
      );
      if (matches) activeUses += matches.length;
    }
    expect(activeUses).toBe(0);
  });
});
