import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type { SourceMenu } from "../domain/schema/source.js";
import type { CategoryMappingResult, ProductCategoryMappingResult } from "../planning/categoryMapping.js";
import { classifyChoiceSemantics } from "./consolidate.js";

export type FinalDecisionOption = {
  id: string;
  label: string;
  effect: string;
};

export type FinalHumanDecision = {
  id: string;
  type:
    | "MENU_PRICE_OPTION_SEMANTICS"
    | "PRODUCT_CHOICE"
    | "DESTINATION_CATEGORY"
    | "OTHER_SEMANTIC";
  title: string;
  affectedProducts: Array<{ menuNumber: string; name: string }>;
  sourceText: string;
  currentInterpretation: string;
  whyNecessary: string;
  options: FinalDecisionOption[];
  recommendedOptionId: string | null;
  recommendedRationale: string | null;
};

function ore(n: number | undefined): string {
  if (n === undefined) return "?";
  return `${n / 100} kr`;
}

/** Strip internal OCR/spatial diagnostic suffixes from operator-facing text. */
export function operatorFacingEvidence(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .split(/\s*\|\|\s*\[/)[0]!
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Assert operator-facing review facts match SourceMenu / CanonicalMenu.
 * Throws with details when stale/mismatched.
 */
export function assertReviewConsistentWithMenus(input: {
  decisions: FinalHumanDecision[];
  sourceMenu: SourceMenu;
  canonical: CanonicalMenu;
}): void {
  const srcByNum = new Map(
    input.sourceMenu.categories.flatMap((c) =>
      c.products.map((p) => [p.sourceMenuNumber ?? "", p] as const),
    ),
  );
  const canByNum = new Map(
    input.canonical.categories.flatMap((c) =>
      c.products.map((p) => [p.sourceMenuNumber ?? "", p] as const),
    ),
  );
  const errors: string[] = [];

  for (const d of input.decisions) {
    for (const ap of d.affectedProducts) {
      const src = srcByNum.get(ap.menuNumber);
      const can = canByNum.get(ap.menuNumber);
      if (!src) {
        errors.push(`${d.id}: missing source product ${ap.menuNumber}`);
        continue;
      }
      if (ap.name !== src.name) {
        errors.push(
          `${d.id}: review name "${ap.name}" != source "${src.name}" for #${ap.menuNumber}`,
        );
      }
      if (can && ap.name !== can.name) {
        errors.push(
          `${d.id}: review name "${ap.name}" != canonical "${can.name}" for #${ap.menuNumber}`,
        );
      }
      if (/\[\s*(spatial|region-ocr|col-shift|base-menu)/i.test(d.sourceText)) {
        errors.push(`${d.id}: operator sourceText still contains diagnostic tags`);
      }
    }
    if (d.id === "D-MENU-OPTION") {
      for (const ap of d.affectedProducts) {
        const src = srcByNum.get(ap.menuNumber);
        const can = canByNum.get(ap.menuNumber);
        if (!src || !can) continue;
        const baseOpt = src.sourcePriceOptions?.find((o) => o.label === "BASE");
        const menuOpt = src.sourcePriceOptions?.find((o) => o.label === "Menu");
        const menuVar = can.variants.find((v) => v.name === "Menu");
        const expected = `#${ap.menuNumber} ${src.name}: BASE ${ore(baseOpt?.sourceTotalPrice)} / Menu ${ore(menuOpt?.sourceTotalPrice)}`;
        if (!d.sourceText.includes(expected)) {
          errors.push(
            `D-MENU-OPTION stale/mismatched line for #${ap.menuNumber}; expected "${expected}"`,
          );
        }
        if (
          baseOpt &&
          can.basePrice !== undefined &&
          baseOpt.sourceTotalPrice !== can.basePrice
        ) {
          errors.push(
            `#${ap.menuNumber}: source BASE ${baseOpt.sourceTotalPrice} != canonical basePrice ${can.basePrice}`,
          );
        }
        if (baseOpt && menuOpt && menuVar) {
          const delta =
            (menuOpt.sourceTotalPrice ?? 0) - (baseOpt.sourceTotalPrice ?? 0);
          if (menuVar.surcharge !== delta) {
            errors.push(
              `#${ap.menuNumber}: Menu surcharge mismatch (canonical ${menuVar.surcharge} vs source delta ${delta})`,
            );
          }
        }
      }
    }
  }

  if (errors.length) {
    throw new Error(
      `Review artifact inconsistent with menus:\n${errors.join("\n")}`,
    );
  }
}

/**
 * Semantic-only human decisions grouped by decision type.
 * Clear names/prices/Alm-Familie math are NOT included.
 */
export function buildFinalHumanReview(input: {
  sourceMenu: SourceMenu;
  canonical: CanonicalMenu;
  categoryMappings: CategoryMappingResult[];
  productMappings: ProductCategoryMappingResult[];
}): {
  generatedAt: string;
  decisions: FinalHumanDecision[];
  markdown: string;
} {
  const decisions: FinalHumanDecision[] = [];
  const srcProducts = input.sourceMenu.categories.flatMap((c) =>
    c.products.map((p) => ({ cat: c.name, p })),
  );
  const byNum = new Map(
    srcProducts.map((x) => [x.p.sourceMenuNumber ?? "", x]),
  );
  const canByNum = new Map(
    input.canonical.categories.flatMap((c) =>
      c.products.map((p) => [p.sourceMenuNumber ?? "", p]),
    ),
  );

  // A. MENU PRICE OPTION SEMANTICS — prices from current SourceMenu (not stale copy)
  const menuProducts = srcProducts
    .filter((x) =>
      (x.p.sourcePriceOptions ?? []).some((o) => o.label === "Menu"),
    )
    .sort(
      (a, b) =>
        Number(a.p.sourceMenuNumber) - Number(b.p.sourceMenuNumber) ||
        String(a.p.sourceMenuNumber).localeCompare(
          String(b.p.sourceMenuNumber),
        ),
    );
  if (menuProducts.length) {
    const lines = menuProducts.map((x) => {
      const base = x.p.sourcePriceOptions?.find((o) => o.label === "BASE");
      const menu = x.p.sourcePriceOptions?.find((o) => o.label === "Menu");
      const can = canByNum.get(x.p.sourceMenuNumber ?? "");
      const name = can?.name ?? x.p.name;
      return `#${x.p.sourceMenuNumber} ${name}: BASE ${ore(base?.sourceTotalPrice)} / Menu ${ore(menu?.sourceTotalPrice)}`;
    });
    decisions.push({
      id: "D-MENU-OPTION",
      type: "MENU_PRICE_OPTION_SEMANTICS",
      title: "How should the source “Menu” price option be represented in TakeAwayHero?",
      affectedProducts: menuProducts.map((x) => ({
        menuNumber: x.p.sourceMenuNumber ?? "",
        name: canByNum.get(x.p.sourceMenuNumber ?? "")?.name ?? x.p.name,
      })),
      sourceText: lines.join("\n"),
      currentInterpretation:
        "Each product keeps BASE as basePrice and a provisional variant/option named “Menu” with derived surcharge. Menu contents are NOT inferred.",
      whyNecessary:
        "Source shows a Menu price column but does not document what the Menu includes (drink, fries, etc.). Representation (variant vs combo/ProductChoice) is a product-model decision.",
      options: [
        {
          id: "variant",
          label: "Keep “Menu” as a priced variant/option per product (current)",
          effect:
            "Imports both prices now; combo contents can be added later. No invented inclusions.",
        },
        {
          id: "combo-later",
          label: "Treat as combo/ProductChoice — hold creates until contents confirmed",
          effect:
            "Products stay REVIEW until an operator specifies Menu composition; prices preserved as evidence.",
        },
        {
          id: "base-only",
          label: "Import BASE only; ignore Menu column for v1",
          effect: "Loses Menu upsell prices until a later enrichment pass.",
        },
      ],
      recommendedOptionId: "variant",
      recommendedRationale:
        "Safest: preserves exact source prices without inventing Menu contents. Semantics can be upgraded once contents are known.",
    });
  }

  // B. PRODUCT CHOICES — group by choice pattern
  const choiceGroups = new Map<
    string,
    Array<{ menuNumber: string; name: string; evidence: string; label: string }>
  >();
  for (const { p } of srcProducts) {
    const cleanEv = operatorFacingEvidence(p.evidence?.rawText);
    const text = `${cleanEv} ${p.ingredients.map((i) => i.display).join(", ")} ${p.productChoices.map((c) => c.prompt).join("; ")}`;
    const classified = classifyChoiceSemantics(text);
    const displayName =
      canByNum.get(p.sourceMenuNumber ?? "")?.name ?? p.name;
    const ingredientLine = p.ingredients.map((i) => i.display).join(", ");
    const choiceLine = p.productChoices.map((c) => c.prompt).join("; ");
    const operatorSrc = [
      `#${p.sourceMenuNumber} ${displayName}`,
      ingredientLine ? `Ingredients: ${ingredientLine}` : null,
      choiceLine ? `Choices: ${choiceLine}` : null,
      cleanEv ? `Source: ${cleanEv.slice(0, 240)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    for (const ch of classified) {
      if (
        ch.classification !== "PRODUCT_CHOICE" &&
        ch.classification !== "UNRESOLVED"
      ) {
        continue;
      }
      const key = ch.text.toLowerCase();
      const list = choiceGroups.get(key) ?? [];
      list.push({
        menuNumber: p.sourceMenuNumber ?? "",
        name: displayName,
        evidence: operatorSrc,
        label: ch.text,
      });
      choiceGroups.set(key, list);
    }
  }
  let choiceIdx = 0;
  for (const [, group] of choiceGroups) {
    choiceIdx += 1;
    const label = group[0]!.label;
    decisions.push({
      id: `D-CHOICE-${choiceIdx}`,
      type: "PRODUCT_CHOICE",
      title: `Does “${label}” represent a customer choice?`,
      affectedProducts: group.map((g) => ({
        menuNumber: g.menuNumber,
        name: g.name,
      })),
      sourceText: group.map((g) => g.evidence).join("\n---\n"),
      currentInterpretation:
        "Flagged as PRODUCT_CHOICE / unresolved slash-or-eller wording — not silently stored as plain ingredients.",
      whyNecessary:
        "Slash/eller/valgfrit wording may mean the guest picks one option, or may be a fixed recipe list. Wrong choice creates wrong POS modifiers.",
      options: [
        {
          id: "product-choice",
          label: "Model as ProductChoice (customer selects one)",
          effect: "Creates choice options on the product; guest must pick.",
        },
        {
          id: "ingredient",
          label: "Treat as fixed ingredients (no choice UI)",
          effect: "Imports text as ingredients only; no modifier.",
        },
        {
          id: "variant",
          label: "Model as variants (separate sellable sizes/options)",
          effect: "Each option becomes a variant with its own price if priced.",
        },
      ],
      recommendedOptionId: /valgfrit|vælg mellem|eller|\//i.test(label)
        ? "product-choice"
        : null,
      recommendedRationale: /valgfrit|vælg mellem|eller|\//i.test(label)
        ? "Wording indicates an explicit choose-one structure in Danish takeaway menus."
        : null,
    });
  }

  // C. DESTINATION CATEGORY
  const pastaMap = input.categoryMappings.find(
    (m) => m.sourceCategoryName === "Pasta",
  );
  if (pastaMap?.outcome === "MISSING_DESTINATION_CATEGORY") {
    const pastaProducts = srcProducts.filter((x) => x.cat === "Pasta");
    decisions.push({
      id: "D-CAT-PASTA",
      type: "DESTINATION_CATEGORY",
      title: "Create or map a destination category for Pasta?",
      affectedProducts: pastaProducts.map((x) => ({
        menuNumber: x.p.sourceMenuNumber ?? "",
        name: x.p.name,
      })),
      sourceText: "Source heading: Pasta\nProducts: 33–35",
      currentInterpretation:
        "Source category Pasta exists; no destination category match. createCategory remains UNCERTIFIED — dry-run BLOCKs these creates.",
      whyNecessary:
        "Cannot assign Pasta products to an existing destination category without inventing a mapping or creating a category.",
      options: [
        {
          id: "create-pasta",
          label: "Create destination category “Pasta” (when createCategory is certified/authorized)",
          effect: "Unblocks Pasta product creates under a new category.",
        },
        {
          id: "map-existing",
          label: "Map Pasta products into an existing destination category",
          effect: "Requires naming which destination category (e.g. Grill / other).",
        },
        {
          id: "defer",
          label: "Defer Pasta migration",
          effect: "Leave Pasta products out of the first write batch.",
        },
      ],
      recommendedOptionId: "create-pasta",
      recommendedRationale:
        "Source has an explicit Pasta heading with three products — a matching destination category is the cleanest model.",
    });
  }

  const p38 = input.productMappings.find((m) => m.menuNumber === "38");
  if (p38 && p38.outcome === "MANUAL_REVIEW_REQUIRED") {
    const src = byNum.get("38");
    decisions.push({
      id: "D-CAT-38",
      type: "DESTINATION_CATEGORY",
      title: "Where should #38 Hjemmelavet hvidløgsbrød be filed?",
      affectedProducts: [
        { menuNumber: "38", name: src?.p.name ?? "Hjemmelavet hvidløgsbrød" },
      ],
      sourceText:
        operatorFacingEvidence(src?.p.evidence?.rawText)?.slice(0, 240) ||
        "38. Hjemmelavet hvidløgsbrød — unlabelled source block with 36–37",
      currentInterpretation:
        "Not auto-mapped to Durum & Pitabrød solely because it shares an unlabelled source block with #36–37.",
      whyNecessary:
        "Garlic bread may belong under Durum & Pitabrød, Grill, sides/tilbehør, or another destination category — source has no heading.",
      options: [
        {
          id: "durum",
          label: "Assign to Durum & Pitabrød (with #36–37)",
          effect: "Groups breads together; may mix garlic bread with wraps.",
        },
        {
          id: "grill",
          label: "Assign to Grill",
          effect: "Places with other page-5 mains/sides.",
        },
        {
          id: "other",
          label: "Assign to another existing category / defer",
          effect: "Operator names the category or skips #38 in v1.",
        },
      ],
      recommendedOptionId: null,
      recommendedRationale: null,
    });
  }

  // D. OTHER — only true semantic gaps (e.g. missing dest for other cats already covered)
  const otherMissing = input.categoryMappings.filter(
    (m) =>
      m.outcome === "MISSING_DESTINATION_CATEGORY" &&
      m.sourceCategoryName !== "Pasta" &&
      !/^UNLABELLED/i.test(m.sourceCategoryName),
  );
  for (const m of otherMissing) {
    const prods = srcProducts.filter((x) => x.cat === m.sourceCategoryName);
    decisions.push({
      id: `D-CAT-${m.sourceCategoryName.replace(/\W+/g, "_").toUpperCase()}`,
      type: "DESTINATION_CATEGORY",
      title: `Missing destination category for “${m.sourceCategoryName}”`,
      affectedProducts: prods.map((x) => ({
        menuNumber: x.p.sourceMenuNumber ?? "",
        name: x.p.name,
      })),
      sourceText: `Source category: ${m.sourceCategoryName}`,
      currentInterpretation: m.reason,
      whyNecessary: "No safe destination category mapping.",
      options: [
        {
          id: "create",
          label: "Create matching destination category when authorized",
          effect: "Unblocks creates for these products.",
        },
        {
          id: "map",
          label: "Map into an existing destination category",
          effect: "Operator selects target category.",
        },
        {
          id: "defer",
          label: "Defer these products",
          effect: "Exclude from first write batch.",
        },
      ],
      recommendedOptionId: null,
      recommendedRationale: null,
    });
  }

  const markdown = formatMarkdown(decisions);
  return {
    generatedAt: new Date().toISOString(),
    decisions,
    markdown,
  };
}

function formatMarkdown(decisions: FinalHumanDecision[]): string {
  const lines: string[] = [
    "# Veroni — Final human review decisions",
    "",
    "Semantic decisions only. Clear names, prices, Alm./Familie arithmetic, and Lille/Stor are extraction-owned and are not listed here.",
    "",
    `Total decisions: **${decisions.length}**`,
    "",
  ];
  for (const d of decisions) {
    lines.push(`## ${d.id} — ${d.title}`);
    lines.push("");
    lines.push(`**Type:** ${d.type}`);
    lines.push("");
    lines.push("**Affected products:**");
    for (const p of d.affectedProducts) {
      lines.push(`- ${p.menuNumber} ${p.name}`);
    }
    lines.push("");
    lines.push("**Source text:**");
    lines.push("```");
    lines.push(d.sourceText);
    lines.push("```");
    lines.push("");
    lines.push(`**Current interpretation:** ${d.currentInterpretation}`);
    lines.push("");
    lines.push(`**Why a decision is necessary:** ${d.whyNecessary}`);
    lines.push("");
    lines.push("**Options:**");
    for (const o of d.options) {
      const rec =
        d.recommendedOptionId === o.id ? " ← recommended" : "";
      lines.push(`- \`${o.id}\` **${o.label}**${rec}`);
      lines.push(`  - Effect: ${o.effect}`);
    }
    if (d.recommendedOptionId && d.recommendedRationale) {
      lines.push("");
      lines.push(`**Recommended:** \`${d.recommendedOptionId}\` — ${d.recommendedRationale}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}
