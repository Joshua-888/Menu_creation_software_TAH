/**
 * Portal spine parity — Create and QA both call runMenuIntelligence.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Portal spine parity", () => {
  it("worker invokes runMenuIntelligence for Create and QA", () => {
    const worker = readFileSync(
      join(process.cwd(), "src/portal/worker.ts"),
      "utf8",
    );
    expect(worker).toMatch(/runMenuIntelligence\(/);
    expect(worker).toMatch(/mode:\s*isQaJob\s*\?\s*"QA_RECONCILE"\s*:\s*"CREATE_MENU"/);
    expect(worker).toMatch(/target-menu\.json/);
    expect(worker).toMatch(/quality-report\.json/);
  });

  it("dryRun toPayload does not call resolveGrillIngredients", () => {
    const dry = readFileSync(
      join(process.cwd(), "src/planning/dryRun.ts"),
      "utf8",
    );
    expect(dry).not.toMatch(/resolveGrillIngredients/);
    expect(dry).not.toMatch(/preferGrillDipAdditions/);
    expect(dry).not.toMatch(/preferBurgerEkstraAdditions/);
    expect(dry).not.toMatch(/proposePizzaToppingsFromDescription/);
  });

  it("qaLiveImprove buildQaTargetPayload does not invent grill fills", () => {
    const qa = readFileSync(
      join(process.cwd(), "src/planning/qaLiveImprove.ts"),
      "utf8",
    );
    // File may still import for fieldQualityScore helpers — ensure buildQa body
    // does not call invent functions (string absence of call sites).
    expect(qa).not.toMatch(/resolveGrillIngredients\(/);
    expect(qa).not.toMatch(/preferGrillDipAdditions\(/);
    expect(qa).not.toMatch(/preferBurgerEkstraAdditions\(/);
    expect(qa).not.toMatch(/proposePizzaToppingsFromDescription\(/);
    expect(qa).not.toMatch(/inferGrillDescription\(/);
  });
});
