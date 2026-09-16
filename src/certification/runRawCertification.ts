/**
 * Certification harness — same production functions as portal Create.
 * RAW bytes → PdfSourceAdapter → domain → runMenuIntelligence → quality.
 * No live writes. No merchant-specific branches.
 */

import { resolve } from "node:path";
import { PdfSourceAdapter } from "../extraction/pdf/adapter.js";
import { runDomainEngine } from "../domain/engine.js";
import { normalizeSourceCategoriesByKind } from "../learning/categoryKindNaming.js";
import { loadPeerSnapshots } from "../learning/peerArtifacts.js";
import { runMenuIntelligence } from "../intelligence/menuIntelligenceEngine.js";
import type { MenuIntelligenceResult } from "../intelligence/types.js";
import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type { SemanticMenu, SemanticProduct } from "./semanticComparator.js";
import { isForbiddenMenuVariantName } from "../learning/categorySizeVariantPolicy.js";

export type RawCertificationInput = {
  restaurantName: string;
  restaurantKey: string;
  /** Absolute path to raw PDF or image. */
  rawFilePath: string;
  kind: "pdf" | "image";
  repoRoot: string;
};

export type RawCertificationResult = {
  pageCount: number;
  uniqueProducts: number;
  sourceProductCount: number;
  sourceMenu: unknown;
  domainMenu: CanonicalMenu;
  intelligence: MenuIntelligenceResult;
  targetMenu: CanonicalMenu;
  semantic: SemanticMenu;
  menuVariantCount: number;
  stats: {
    targetProducts: number;
    qualityReady: number;
    qualityReview: number;
    qualityBlocked: number;
    menuStatus: string;
    statusAccounting: {
      productCount: number;
      ready: number;
      review: number;
      blocked: number;
      reconciles: boolean;
    };
    findingCounts: {
      failedChecks: number;
      coherenceFailures: number;
    };
  };
};

export function canonicalToSemantic(menu: CanonicalMenu): SemanticMenu {
  const products: SemanticProduct[] = [];
  for (const c of menu.categories) {
    for (const p of c.products) {
      const item: SemanticProduct = {
        name: p.name,
        category: c.name,
        ingredients: p.ingredients.map((i) => i.display),
        variants: p.variants.map((v) => v.name),
        additions: p.addOns.map((a) => {
          const add: { name: string; priceOre?: number } = { name: a.name };
          if (a.price != null) add.priceOre = a.price;
          return add;
        }),
        isCombo: p.isCombo,
      };
      const num = p.assignedMenuNumber ?? p.sourceMenuNumber;
      if (num) item.menuNumber = num;
      if (p.basePrice != null) item.basePriceOre = p.basePrice;
      if (p.description) item.description = p.description;
      products.push(item);
    }
  }
  return { products };
}

export async function runRawSourceCertification(
  input: RawCertificationInput,
): Promise<RawCertificationResult> {
  const adapter = new PdfSourceAdapter({
    restaurantName: input.restaurantName,
  });
  const extraction = await adapter.extractDetailed({
    kind: input.kind,
    filePath: resolve(input.rawFilePath),
  });

  const peers = loadPeerSnapshots(input.repoRoot);
  const named = normalizeSourceCategoriesByKind(extraction.sourceMenu, peers);
  const domain = runDomainEngine(named);

  const intelligence = runMenuIntelligence({
    mode: "CREATE_MENU",
    restaurantName: input.restaurantName,
    restaurantKey: input.restaurantKey,
    canonicalMenu: domain.menu,
  });

  const targetMenu = intelligence.targetMenu;
  const semantic = canonicalToSemantic(targetMenu);
  let menuVariantCount = 0;
  for (const p of semantic.products) {
    for (const v of p.variants) {
      if (isForbiddenMenuVariantName(v)) menuVariantCount += 1;
    }
  }

  const sourceProductCount = named.categories.reduce(
    (n, c) => n + c.products.length,
    0,
  );

  return {
    pageCount: extraction.pageCount,
    uniqueProducts: extraction.uniqueProducts,
    sourceProductCount,
    sourceMenu: named,
    domainMenu: domain.menu,
    intelligence,
    targetMenu,
    semantic,
    menuVariantCount,
    stats: {
      targetProducts: semantic.products.length,
      qualityReady: intelligence.quality.statusAccounting.ready,
      qualityReview: intelligence.quality.statusAccounting.review,
      qualityBlocked: intelligence.quality.statusAccounting.blocked,
      menuStatus: intelligence.quality.menuStatus,
      statusAccounting: intelligence.quality.statusAccounting,
      findingCounts: intelligence.quality.findingCounts,
    },
  };
}
