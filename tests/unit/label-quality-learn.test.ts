import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DecisionPolicyRegistry } from "../../src/decisions/engine.js";
import { DecisionStore } from "../../src/decisions/store.js";
import {
  buildLabelQualityDecisionCase,
  encodeLabelCorrection,
  gateWriteLabels,
  parseLabelCorrection,
  recordLabelQualityCorrection,
} from "../../src/decisions/labelQuality.js";
import { clearLearnedOcrIngredientFixes } from "../../src/domain/learnedTextFixes.js";

const dirs: string[] = [];

function openStore(): DecisionStore {
  const dir = mkdtempSync(join(tmpdir(), "label-qc-"));
  dirs.push(dir);
  return new DecisionStore(join(dir, "decisions.sqlite"));
}

beforeEach(() => {
  clearLearnedOcrIngredientFixes();
});

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("label quality learn loop", () => {
  it("encodes and parses LABEL_CORRECTION payloads", () => {
    const raw = encodeLabelCorrection({
      name: "gorgonzola 1",
      ingredients: ["skinke", "dressing 95"],
      ocrFixes: [{ from: "champignom", to: "champignon" }],
    });
    const parsed = parseLabelCorrection(raw);
    expect(parsed?.name).toBe("Gorgonzola 1");
    expect(parsed?.ingredients).toEqual(["Skinke", "Dressing"]);
    expect(parsed?.ocrFixes?.[0]?.to).toBe("champignon");
  });

  it("blocks bad labels then passes after human restaurant correction", () => {
    const store = openStore();
    const registry = new DecisionPolicyRegistry(store);

    const blocked = gateWriteLabels({
      store,
      restaurantKey: "veronipizza.dk",
      menuNumber: "16",
      name: "I15,",
      ingredients: ["skinke", "champignon", "løg"],
    });
    expect(blocked.ok).toBe(false);

    const dc = buildLabelQualityDecisionCase({
      runId: "test",
      restaurantKey: "veronipizza.dk",
      menuNumber: "16",
      productName: "I15,",
      ingredients: ["skinke", "champignon", "løg"],
      assessment: blocked.assessment,
    });
    recordLabelQualityCorrection({
      store,
      registry,
      decisionCase: dc,
      correction: {
        name: "Gorgonzola 1",
        ingredients: [
          "Skinke",
          "Champignon",
          "Løg",
          "Tomat",
          "Ost",
          "Gorgonzola",
        ],
        ocrFixes: [{ from: "I15", to: "Gorgonzola" }],
      },
      scopePreference: "APPLY_TO_THIS_RESTAURANT",
    });

    const gated = gateWriteLabels({
      store,
      restaurantKey: "veronipizza.dk",
      menuNumber: "16",
      name: "I15,",
      ingredients: ["skinke", "champignon", "løg"],
    });
    expect(gated.ok).toBe(true);
    expect(gated.fromPrecedent).toBe(true);
    expect(gated.name).toBe("Gorgonzola 1");
    expect(gated.ingredients[0]).toBe("Skinke");
  });
});
