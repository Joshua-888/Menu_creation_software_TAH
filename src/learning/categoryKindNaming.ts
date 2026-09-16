/**
 * SEMANTIC_RULE: normalize source category labels by product kind + peer modal names.
 *
 * Never restaurant-specific. "Grill" is a cooking method — when products are
 * sandwich_grill kind, prefer peer modal category label (often "Burgers").
 */

import type { SourceMenu } from "../domain/schema/source.js";
import {
  classifyProductKind,
  type ProductKind,
} from "./categoryLikelihood.js";
import type { PeerMenuSnapshot } from "./peerMenuStructure.js";

/** Canonical fallback labels by kind when peers lack a modal name. */
const KIND_FALLBACK_CATEGORY: Partial<Record<ProductKind, string>> = {
  sandwich_grill: "Burgers",
  pizza: "Pizza",
  pasta: "Pasta",
  drinks: "Drikkevarer",
  finger_food: "Sides",
  indian: "Indisk",
  nachos: "Nachos",
  menu_with_fries: "Menuer",
};

const GENERIC_COOKING_METHOD_RE = /^(grill|grillen|bbq|barbeque)$/i;

export function peerModalCategoryForKind(
  peers: PeerMenuSnapshot[] | null | undefined,
  kind: ProductKind,
): string | null {
  if (!peers?.length) return null;
  const counts = new Map<string, number>();
  for (const peer of peers) {
    for (const p of peer.products ?? []) {
      const cats = p.categoryNames ?? [];
      const k = classifyProductKind({
        name: p.name,
        categoryNames: cats,
        ...(p.description ? { description: p.description } : {}),
      });
      if (k !== kind) continue;
      for (const labelRaw of cats) {
        const label = labelRaw.trim();
        if (!label || GENERIC_COOKING_METHOD_RE.test(label)) continue;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [label, n] of counts) {
    if (n > bestN) {
      best = label;
      bestN = n;
    }
  }
  return bestN >= 2 ? best : null;
}

function majorityKind(
  products: Array<{ name: string; description?: string }>,
  categoryName: string,
): ProductKind | null {
  const tallies = new Map<ProductKind, number>();
  for (const p of products) {
    const k = classifyProductKind({
      name: p.name,
      categoryNames: [categoryName],
      ...(p.description ? { description: p.description } : {}),
    });
    tallies.set(k, (tallies.get(k) ?? 0) + 1);
  }
  let best: ProductKind | null = null;
  let bestN = 0;
  for (const [k, n] of tallies) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  if (!best || bestN < Math.ceil(products.length * 0.5)) return null;
  return best;
}

/**
 * Rename generic cooking-method / placeholder categories using peer modal
 * names for the majority product kind (fallback: kind canonical label).
 */
export function normalizeSourceCategoriesByKind(
  menu: SourceMenu,
  peers?: PeerMenuSnapshot[] | null,
): SourceMenu {
  const categories = menu.categories.map((cat) => {
    const name = cat.name.trim();
    const needsRename =
      GENERIC_COOKING_METHOD_RE.test(name) ||
      /^unlabelled/i.test(name) ||
      /^uncategorized$/i.test(name) ||
      !name;
    if (!needsRename || cat.products.length === 0) return cat;

    const kind = majorityKind(
      cat.products.map((p) => ({
        name: p.name,
        ...(p.description ? { description: p.description } : {}),
      })),
      name || "UNCATEGORIZED",
    );
    if (!kind) return cat;

    const peerLabel = peerModalCategoryForKind(peers, kind);
    const next = peerLabel ?? KIND_FALLBACK_CATEGORY[kind];
    if (!next || next.toLowerCase() === name.toLowerCase()) return cat;
    return { ...cat, name: next };
  });

  return { ...menu, categories };
}
