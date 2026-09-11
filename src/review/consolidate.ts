import type { CanonicalMenu } from "../domain/schema/canonical.js";
import type { SourceMenu } from "../domain/schema/source.js";
import type { HumanReviewItem } from "./humanReport.js";

export type ChoiceClassification =
  | "INGREDIENT"
  | "VARIANT"
  | "PRODUCT_CHOICE"
  | "UNRESOLVED";

export type ConsolidatedReviewItem = {
  menuNumber: string;
  productName: string;
  exactAmbiguity: string;
  sourceInterpretation: string;
  recommendedOptions: string[];
  sourceEvidence: string;
  ifApproved: string;
  choiceClassifications: Array<{
    text: string;
    classification: ChoiceClassification;
  }>;
  underlyingIssueCodes: string[];
};

const CHOICE_PATTERNS: Array<{
  re: RegExp;
  label: string;
  classification: ChoiceClassification;
}> = [
  {
    re: /valgfrit\s+k[oø]d/i,
    label: "valgfrit kød",
    classification: "PRODUCT_CHOICE",
  },
  {
    re: /skinke\s*\/\s*kebab/i,
    label: "skinke/kebab",
    classification: "PRODUCT_CHOICE",
  },
  {
    re: /kylling\s*(eller|\/)\s*oksek[oø]d|kylling\s*(eller|\/)\s*okse\b/i,
    label: "kylling eller oksekød",
    classification: "PRODUCT_CHOICE",
  },
  {
    re: /kylling\s*\/\s*okse\s*\/\s*vegetar/i,
    label: "kylling/okse/vegetar",
    classification: "PRODUCT_CHOICE",
  },
  {
    re: /kylling\s*\/\s*okse\s*\/\s*gr[øo]ntsager\s*\/\s*rejer/i,
    label: "kylling/okse/grøntsager/rejer",
    classification: "PRODUCT_CHOICE",
  },
  {
    re: /vælg mellem/i,
    label: "Vælg mellem",
    classification: "PRODUCT_CHOICE",
  },
];

export function classifyChoiceSemantics(text: string): Array<{
  text: string;
  classification: ChoiceClassification;
}> {
  const out: Array<{ text: string; classification: ChoiceClassification }> = [];
  for (const p of CHOICE_PATTERNS) {
    if (p.re.test(text)) {
      out.push({ text: p.label, classification: p.classification });
    }
  }
  // Slash lists without explicit choose words → UNRESOLVED
  if (
    out.length === 0 &&
    /\b\w+\s*\/\s*\w+/.test(text) &&
    /(kylling|okse|skinke|kebab|vegetar|rejer)/i.test(text)
  ) {
    out.push({
      text: "slash protein/option list",
      classification: "UNRESOLVED",
    });
  }
  return out;
}

function decisionKey(menuNumber: string, codes: string[], name: string): string {
  const theme = codes
    .map((c) => {
      if (/CHOICE|choice|slash|valg|Vælg|kylling|kebab/i.test(c)) return "CHOICE";
      if (/Menu|BASE|combo/i.test(c)) return "MENU_PRICE";
      if (/PRICE|price|Alm|Familie|variant/i.test(c)) return "PRICE";
      if (/NAME|name|unnamed|incomplete/i.test(c)) return "NAME";
      if (/CATEGOR|destination|Pasta|mapping/i.test(c)) return "CATEGORY";
      if (/BLOCK|status/i.test(c)) return "STATUS";
      return c.slice(0, 24);
    })
    .sort()
    .join("+");
  return `${menuNumber}::${theme || "GENERAL"}::${name.slice(0, 20)}`;
}

/**
 * Collapse many low-level review messages into PRODUCT + DECISION items.
 */
export function consolidateHumanReview(input: {
  sourceMenu: SourceMenu;
  canonical: CanonicalMenu;
  items: HumanReviewItem[];
}): {
  generatedAt: string;
  decisions: ConsolidatedReviewItem[];
  counts: { products: number; decisions: number; rawItems: number };
} {
  const byProduct = new Map<
    string,
    { menuNumber: string; name: string; items: HumanReviewItem[]; evidence: string }
  >();

  for (const cat of input.sourceMenu.categories) {
    for (const p of cat.products) {
      const mn = p.sourceMenuNumber ?? "";
      byProduct.set(p.sourceId, {
        menuNumber: mn,
        name: p.name,
        items: [],
        evidence: p.evidence?.rawText ?? "",
      });
    }
  }

  for (const item of input.items) {
    if (!item.sourceId) continue;
    let bucket = byProduct.get(item.sourceId);
    if (!bucket) {
      bucket = {
        menuNumber: item.menuNumber,
        name: item.name,
        items: [],
        evidence: "",
      };
      byProduct.set(item.sourceId, bucket);
    }
    bucket.items.push(item);
  }

  // Also fold canonical MRR/BLOCKED products with empty raw items
  for (const cat of input.canonical.categories) {
    for (const p of cat.products) {
      if (p.status === "READY") continue;
      const bucket = byProduct.get(p.sourceId) ?? {
        menuNumber: p.sourceMenuNumber ?? p.assignedMenuNumber ?? "",
        name: p.name,
        items: [],
        evidence: p.evidence?.rawText ?? "",
      };
      if (bucket.items.length === 0) {
        bucket.items.push({
          sourceId: p.sourceId,
          menuNumber: bucket.menuNumber,
          name: p.name,
          category: cat.name,
          field: "status",
          extractedValue: p.status,
          reasonCode: p.status,
          recommendedInterpretation: p.issues.map((i) => i.message).join("; "),
          status: p.status,
        });
      }
      byProduct.set(p.sourceId, bucket);
    }
  }

  const decisionMap = new Map<string, ConsolidatedReviewItem>();

  for (const [, bucket] of byProduct) {
    if (bucket.items.length === 0) continue;
    const codes = [
      ...new Set(bucket.items.map((i) => i.reasonCode).filter(Boolean)),
    ];
    const key = decisionKey(bucket.menuNumber, codes, bucket.name);
    const choices = classifyChoiceSemantics(bucket.evidence);
    const hasChoice = choices.some(
      (c) =>
        c.classification === "PRODUCT_CHOICE" ||
        c.classification === "UNRESOLVED",
    );

    let exactAmbiguity = bucket.items
      .map((i) => i.recommendedInterpretation || i.reasonCode)
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ");
    if (hasChoice) {
      exactAmbiguity = `Does ${choices.map((c) => c.text).join(" / ")} represent customer choice?`;
    }

    const recommendedOptions = hasChoice
      ? [
          "Treat as PRODUCT_CHOICE (customer selects one)",
          "Treat as INGREDIENT list (no choice UI)",
          "Treat as VARIANT set",
        ]
      : codes.some((c) => /Menu|BASE/i.test(c))
        ? [
            "Keep Menu as source price option / variant named Menu",
            "Model as ProductChoice/Combo once contents are confirmed",
            "MANUAL_REVIEW_REQUIRED until combo contents are known",
          ]
        : [
            "Approve current extraction",
            "Correct name/price from PDF image",
            "Leave MANUAL_REVIEW_REQUIRED",
          ];

    const ifApproved = hasChoice
      ? "Approved choice will become ProductChoice options; will not silently stay as ingredients."
      : codes.some((c) => /Menu/i.test(c))
        ? "Menu price remains a source option; no Menu category; combo body still blocked until specified."
        : "Product may move toward READY/CREATE in a later authorized write run.";

    const existing = decisionMap.get(key);
    if (existing) {
      existing.underlyingIssueCodes = [
        ...new Set([...existing.underlyingIssueCodes, ...codes]),
      ];
      continue;
    }

    decisionMap.set(key, {
      menuNumber: bucket.menuNumber,
      productName: bucket.name,
      exactAmbiguity,
      sourceInterpretation: bucket.items[0]?.recommendedInterpretation ||
        bucket.items[0]?.reasonCode ||
        "needs human decision",
      recommendedOptions,
      sourceEvidence: bucket.evidence.slice(0, 400),
      ifApproved,
      choiceClassifications: choices,
      underlyingIssueCodes: codes,
    });
  }

  const decisions = [...decisionMap.values()].sort((a, b) => {
    const an = Number(a.menuNumber.match(/^(\d+)/)?.[1] ?? 9999);
    const bn = Number(b.menuNumber.match(/^(\d+)/)?.[1] ?? 9999);
    return an - bn || a.menuNumber.localeCompare(b.menuNumber);
  });

  return {
    generatedAt: new Date().toISOString(),
    decisions,
    counts: {
      products: new Set(decisions.map((d) => d.menuNumber)).size,
      decisions: decisions.length,
      rawItems: input.items.length,
    },
  };
}
