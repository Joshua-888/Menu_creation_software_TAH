import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzePeerMenu,
  distillStructurePatterns,
  type PeerMenuSnapshot,
} from "../../src/learning/peerMenuStructure.js";
import {
  defaultStructurePattern,
  upsertStructureSemanticPolicy,
  upsertVeroniTilbehorBusinessFact,
  loadActiveStructurePattern,
} from "../../src/learning/structurePolicy.js";
import { DecisionStore } from "../../src/decisions/store.js";
import {
  fanOutRestaurantAdditions,
  mapProductChoicesToWriteFields,
} from "../../src/planning/structureMapping.js";
import {
  isStructureWriteConfirmed,
  assertStructureWriteConfirmed,
} from "../../src/portal/structureWriteGate.js";
import type { CanonicalMenu, CanonicalProduct } from "../../src/domain/schema/canonical.js";
import { readFileSync } from "node:fs";

const dirs: string[] = [];

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

function loadFixtures(): PeerMenuSnapshot[] {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), "fixtures/peer-menus/best-customers.json"),
      "utf8",
    ),
  ) as PeerMenuSnapshot[];
}

describe("peer menu structure learning", () => {
  it("distills SEMANTIC_RULE: meat as variants without size; additions with size; restaurant tilbehør", () => {
    const snaps = loadFixtures();
    const summary = distillStructurePatterns(snaps);
    expect(summary.restaurantsAnalyzed).toBe(2);
    expect(summary.meatChoiceWithoutSize).toBe("variants");
    expect(summary.meatChoiceWithSize).toBe("additions");
    expect(summary.tilbehorScope).toBe("RESTAURANT");
    expect(summary.sharedAdditionCoverage).toBeGreaterThanOrEqual(0.5);
  });

  it("persists ACTIVE structure policy and loads it back", () => {
    const dir = mkdtempSync(join(tmpdir(), "peer-struct-"));
    dirs.push(dir);
    const store = new DecisionStore(join(dir, "d.sqlite"));
    const summary = distillStructurePatterns(loadFixtures());
    upsertStructureSemanticPolicy({ store, summary });
    const loaded = loadActiveStructurePattern(store);
    expect(loaded?.fingerprint).toBe(summary.fingerprint);
    expect(loaded?.meatChoiceWithoutSize).toBe("variants");
    store.close();
  });

  it("maps meat choices to variants when no size pair; strips Menu (Menuer is a category)", () => {
    const pattern = distillStructurePatterns(loadFixtures());
    const pitaLike = {
      sourceId: "p1",
      name: "Pita",
      status: "READY" as const,
      variants: [{ sourceId: "v1", name: "Alm.", nameOrigin: "SOURCE" as const, surcharge: 0, surchargeOrigin: "SOURCE" as const, isBase: true }],
      ingredients: [],
      addOns: [],
      productChoices: [
        {
          sourceId: "c1",
          prompt: "Vælg variant",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: [
            { productSourceId: "choice-opt:kebab", label: "Kebab" },
            { productSourceId: "choice-opt:kylling", label: "Kylling" },
          ],
        },
      ],
    };
    const mappedNoSize = mapProductChoicesToWriteFields(
      pitaLike as unknown as CanonicalProduct,
      pattern,
    );
    expect(mappedNoSize.variants.map((v) => v.name)).toEqual([
      "Kebab",
      "Kylling",
    ]);

    const withMenu = {
      ...pitaLike,
      variants: [
        { sourceId: "v1", name: "Alm.", nameOrigin: "SOURCE" as const, surcharge: 0, surchargeOrigin: "SOURCE" as const, isBase: true },
        { sourceId: "v2", name: "Menu", nameOrigin: "SOURCE" as const, surcharge: 5000, surchargeOrigin: "SOURCE" as const, isBase: false },
      ],
    };
    const mappedStripMenu = mapProductChoicesToWriteFields(
      withMenu as unknown as CanonicalProduct,
      pattern,
    );
    expect(mappedStripMenu.variants.some((v) => /menu/i.test(v.name))).toBe(
      false,
    );
  });

  it("fans out Veroni Tilbehør BUSINESS_FACT onto products without source addOns", () => {
    const dir = mkdtempSync(join(tmpdir(), "peer-til-"));
    dirs.push(dir);
    const store = new DecisionStore(join(dir, "d.sqlite"));
    const prevSeed = process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
    process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = "veronipizza.dk";
    upsertVeroniTilbehorBusinessFact({
      store,
      restaurantKey: "veronipizza.dk",
    });
    const menu: CanonicalMenu = {
      schemaVersion: "1",
      domainRuleVersion: "1",
      restaurant: "veronipizza.dk",
      source: "test",
      categories: [
        {
          sourceId: "cat1",
          name: "PIZZA",
          products: [
            {
              sourceId: "p-empty",
              sourceMenuNumber: "1",
              name: "Margherita",
              status: "READY",
              variants: [],
              ingredients: [],
              addOns: [],
            },
            {
              sourceId: "p-49",
              sourceMenuNumber: "49",
              name: "Ekstra tilbehør",
              status: "READY",
              variants: [],
              ingredients: [],
              addOns: [],
            },
            {
              sourceId: "p-has",
              sourceMenuNumber: "32C",
              name: "Stefan",
              status: "READY",
              variants: [],
              ingredients: [],
              addOns: [
                {
                  sourceId: "a1",
                  name: "Ekstra ost",
                  price: 1500,
                  origin: "SOURCE",
                },
              ],
            },
          ],
        },
      ],
    } as unknown as CanonicalMenu;

    const fan = fanOutRestaurantAdditions({
      menu,
      registry: store.facts,
      restaurantKey: "veronipizza.dk",
    });
    expect(fan.appliedMenus).toContain("1");
    expect(fan.appliedMenus).not.toContain("49");
    expect(fan.appliedMenus).not.toContain("32C");
    const p1 = fan.menu.categories[0]!.products.find(
      (p) => p.sourceMenuNumber === "1",
    )!;
    expect(p1.addOns.map((a) => a.name)).toEqual(
      expect.arrayContaining(["Salatmayonnaise", "Remoulade", "Ketchup"]),
    );
    if (prevSeed === undefined) delete process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
    else process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = prevSeed;
    store.close();
  });

  it("blocks live structure writes until confirm file matches fingerprint", () => {
    const dir = mkdtempSync(join(tmpdir(), "peer-gate-"));
    dirs.push(dir);
    const pattern = defaultStructurePattern();
    const confirmPath = join(dir, "confirm.json");
    const blocked = isStructureWriteConfirmed({
      restaurantKey: "veronipizza.dk",
      fingerprint: pattern.fingerprint,
      confirmFilePath: confirmPath,
      env: {},
    });
    expect(blocked.ok).toBe(false);

    writeFileSync(
      confirmPath,
      JSON.stringify({
        confirmed: true,
        restaurantKey: "veronipizza.dk",
        fingerprint: pattern.fingerprint,
        confirmedAt: new Date().toISOString(),
      }),
    );
    const ok = isStructureWriteConfirmed({
      restaurantKey: "veronipizza.dk",
      fingerprint: pattern.fingerprint,
      confirmFilePath: confirmPath,
      env: {},
    });
    expect(ok.ok).toBe(true);
    expect(() =>
      assertStructureWriteConfirmed({
        restaurantKey: "veronipizza.dk",
        fingerprint: pattern.fingerprint,
        confirmFilePath: confirmPath,
        env: {},
      }),
    ).not.toThrow();
  });

  it("analyzePeerMenu finds shared tilbehør coverage", () => {
    const a = analyzePeerMenu(loadFixtures()[0]!);
    expect(a.sharedAdditionSets[0]!.coverage).toBeGreaterThanOrEqual(0.5);
    expect(a.typeVariantProducts).toBeGreaterThanOrEqual(1);
  });
});
