import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionStore } from "../../src/decisions/store.js";
import { resolveAdditionsForProduct } from "../../src/decisions/precedence.js";
import type { CanonicalMenu } from "../../src/domain/schema/canonical.js";
import type { PeerMenuSnapshot } from "../../src/learning/peerMenuStructure.js";
import {
  distillAdditionLikelihood,
  normalizePeerAdditionKey,
  upsertPeerAdditionFactsForMenu,
} from "../../src/learning/additionLikelihood.js";
import { distillProbabilityPolicy } from "../../src/learning/categoryLikelihood.js";
import { applyProbabilityFilterToMenu } from "../../src/planning/structureMapping.js";
import { fanOutRestaurantAdditions } from "../../src/planning/structureMapping.js";
import { upsertVeroniTilbehorBusinessFact } from "../../src/learning/structurePolicy.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* Windows may lock sqlite briefly */
    }
  }
});

function peers(): PeerMenuSnapshot[] {
  return [
    {
      host: "a.dk",
      restaurantKey: "a.dk",
      observedAt: "2026-01-01T00:00:00.000Z",
      source: "fixture",
      products: [
        {
          menuNumber: "1",
          name: "Margherita",
          categoryNames: ["PIZZA"],
          variants: [{ name: "Alm.", priceOre: 0 }],
          additions: [
            { name: "Ekstra ost", priceOre: 1500 },
            { name: "Pepperoni", priceOre: 2500 },
            { name: "Ketchup", priceOre: 1000 },
          ],
        },
        {
          menuNumber: "2",
          name: "Hawaii",
          categoryNames: ["PIZZA"],
          variants: [{ name: "Alm.", priceOre: 0 }],
          additions: [
            { name: "Ekstra ost", priceOre: 1500 },
            { name: "Pepperoni (Familie)", priceOre: 3300 },
            { name: "Ananas", priceOre: 1900 },
          ],
        },
        {
          menuNumber: "3",
          name: "Vesuvio",
          categoryNames: ["PIZZA"],
          variants: [{ name: "Alm.", priceOre: 0 }],
          additions: [
            { name: "Ekstra ost", priceOre: 2000 },
            { name: "Pepperoni", priceOre: 2500 },
            { name: "Champignon", priceOre: 1900 },
          ],
        },
        {
          menuNumber: "80",
          name: "Pommes frites",
          categoryNames: ["Sides"],
          variants: [{ name: "Alm.", priceOre: 0 }],
          additions: [
            { name: "Ketchup", priceOre: 1000 },
            { name: "Remoulade", priceOre: 1000 },
          ],
        },
      ],
    },
    {
      host: "b.dk",
      restaurantKey: "b.dk",
      observedAt: "2026-01-01T00:00:00.000Z",
      source: "fixture",
      products: [
        {
          menuNumber: "1",
          name: "Pizza Margherita",
          categoryNames: ["Pizza"],
          variants: [{ name: "Alm.", priceOre: 0 }],
          additions: [
            { name: "Ekstra ost", priceOre: 1600 },
            { name: "Pepperoni", priceOre: 2400 },
            { name: "Skinke", priceOre: 2400 },
          ],
        },
        {
          menuNumber: "5",
          name: "Calzone",
          categoryNames: ["Pizza"],
          variants: [{ name: "Alm.", priceOre: 0 }],
          additions: [
            { name: "Ekstra ost", priceOre: 1600 },
            { name: "Pepperoni", priceOre: 2400 },
          ],
        },
        {
          menuNumber: "9",
          name: "Indbagt kebab",
          categoryNames: ["Pizza"],
          variants: [{ name: "Alm.", priceOre: 0 }],
          additions: [
            { name: "Ekstra ost", priceOre: 1600 },
            { name: "Kebab", priceOre: 2500 },
          ],
        },
        {
          menuNumber: "200",
          name: "Chicken Nuggets",
          categoryNames: ["Fingerfood"],
          variants: [{ name: "Alm.", priceOre: 0 }],
          additions: [
            { name: "Ketchup", priceOre: 1000 },
            { name: "Remoulade", priceOre: 1000 },
          ],
        },
      ],
    },
  ];
}

describe("addition likelihood", () => {
  it("collapses Alm/Familie peer addition names", () => {
    expect(normalizePeerAdditionKey("Pepperoni (Familie)")).toBe("pepperoni");
    expect(normalizePeerAdditionKey("Hvidløgsdressing fam.")).toMatch(
      /hvidl[øo]gsdressing/,
    );
  });

  it("proposes pizza ekstra toppings with P(name|pizza), excludes dips", () => {
    const policy = distillAdditionLikelihood(peers());
    const pizza = policy.proposedSets.find((p) => p.kind === "pizza");
    expect(pizza).toBeTruthy();
    expect(pizza!.additions.some((a) => /ost/i.test(a.name))).toBe(true);
    expect(pizza!.additions.some((a) => /pepperoni/i.test(a.name))).toBe(true);
    expect(pizza!.additions.every((a) => !a.isDip)).toBe(true);
    const ost = pizza!.additions.find((a) => /ost/i.test(a.nameKey));
    expect(ost!.pHat).toBeGreaterThan(0.5);
  });

  it("fans peer pizza extras onto Veroni #1 and strips mayo dips via probability", () => {
    const dir = mkdtempSync(join(tmpdir(), "addlik-"));
    dirs.push(dir);
    const store = new DecisionStore(join(dir, "d.sqlite"));
    const prevSeed = process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
    process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = "veronipizza.dk";
    try {
      upsertVeroniTilbehorBusinessFact({
        store,
        restaurantKey: "veronipizza.dk",
      });
      const likelihood = distillAdditionLikelihood(peers());
      const menu = {
        schemaVersion: "1.0.0",
        domainRuleVersion: "1",
        restaurant: "veronipizza.dk",
        source: "test",
        categories: [
          {
            sourceId: "cat-pizza",
            name: "PIZZA",
            products: [
              {
                sourceId: "p1",
                sourceMenuNumber: "1",
                name: "Margherita",
                status: "READY",
                variants: [],
                ingredients: [],
                addOns: [],
              },
            ],
          },
        ],
      } as unknown as CanonicalMenu;
      upsertPeerAdditionFactsForMenu({
        store,
        restaurantKey: "veronipizza.dk",
        menu,
        likelihood,
      });

      const fan = fanOutRestaurantAdditions({
        menu,
        registry: store.facts,
        restaurantKey: "veronipizza.dk",
      });
      expect(fan.fanOutMenus).toContain("1");
      const namesBefore = fan.menu.categories[0]!.products[0]!.addOns.map(
        (a) => a.name,
      );
      expect(namesBefore.some((n) => /ost|pepperoni/i.test(n))).toBe(true);

      const prob = distillProbabilityPolicy(peers());
      const filtered = applyProbabilityFilterToMenu({
        menu: fan.menu,
        policy: prob,
        fanOutMenus: fan.fanOutMenus,
      });
      const after = filtered.menu.categories[0]!.products[0]!.addOns.map(
        (a) => a.name,
      );
      expect(after.some((n) => /ketchup|remoulade|mayonnaise/i.test(n))).toBe(
        false,
      );
      expect(after.some((n) => /ost|pepperoni/i.test(n))).toBe(true);

      const resolved = resolveAdditionsForProduct({
        registry: store.facts,
        restaurantKey: "veronipizza.dk",
        sourceCategory: "PIZZA",
        sourceId: "p1",
        menuNumber: "1",
        sourceAdditions: [],
      });
      expect(resolved.additions.length).toBeGreaterThan(2);
    } finally {
      if (prevSeed === undefined) delete process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS;
      else process.env.PORTAL_SEED_DEFAULT_TILBEHOR_HOSTS = prevSeed;
      store.close();
    }
  });
});
