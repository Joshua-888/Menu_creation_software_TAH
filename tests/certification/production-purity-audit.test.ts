/**
 * Production merchant-hardcode + post-TargetMenu purity audits.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".next") continue;
      walkTsFiles(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const ALLOW_PATH_FRAGMENTS = [
  "tests/",
  "fixtures/",
  "scripts/",
  "docs/",
  "runs/",
  "certification/",
];

describe("Production merchant-hardcode audit", () => {
  it("PRODUCTION_REACHABLE_MERCHANT_SPECIFIC_BUSINESS_LOGIC = 0", () => {
    const roots = ["src/intelligence", "src/planning", "src/portal", "src/domain"].map(
      (d) => join(process.cwd(), d),
    );
    const offenders: string[] = [];
    for (const root of roots) {
      for (const f of walkTsFiles(root)) {
        const rel = relative(process.cwd(), f).replace(/\\/g, "/");
        if (ALLOW_PATH_FRAGMENTS.some((a) => rel.includes(a))) continue;
        const text = readFileSync(f, "utf8");
        // Merchant-specific runtime branches (not comments about fixtures)
        if (
          /if\s*\([^)]*(veronipizza|smashmburger|veroni\.|smash\.)/i.test(text) ||
          /restaurantKey\s*===\s*["'][^"']*(veroni|smash)/i.test(text) ||
          /host\s*===\s*["'][^"']*(veronipizza|smashmburger)/i.test(text)
        ) {
          offenders.push(rel);
        }
        // Menu-number-specific semantic branches in intelligence
        if (
          rel.includes("src/intelligence/") &&
          /menuNumber\s*===\s*["']\d+/.test(text)
        ) {
          offenders.push(rel + ":menuNumber-branch");
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Post-TargetMenu business logic purity", () => {
  it("POST_TARGETMENU_BUSINESS_LOGIC = 0 in dryRun/qa write path", () => {
    const files = [
      "src/planning/dryRun.ts",
      "src/planning/qaLiveImprove.ts",
      "src/portal/worker.ts",
    ].map((f) => join(process.cwd(), f));

    const forbidden = [
      /resolveGrillIngredients\s*\(/,
      /preferGrillDipAdditions\s*\(/,
      /preferBurgerEkstraAdditions\s*\(/,
      /proposePizzaToppingsFromDescription\s*\(/,
      /inferGrillDescription\s*\(/,
      /inferDomainIngredientsFromName\s*\(/,
      /completeProductCard\s*\(/,
      /completeCanonicalMenuCards\s*\(/,
    ];

    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const rel = relative(process.cwd(), f).replace(/\\/g, "/");
      for (const re of forbidden) {
        if (re.test(text)) {
          // worker may import runMenuIntelligence (allowed) but not invent helpers
          if (rel.includes("worker.ts") && /runMenuIntelligence/.test(text)) {
            if (!/resolveGrillIngredients\s*\(/.test(text)) continue;
          }
          offenders.push(`${rel} matches ${re}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
