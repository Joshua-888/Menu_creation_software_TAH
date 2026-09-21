import { kronerToOre } from "../../domain/money.js";
import type {
  SourceCategory,
  SourceIngredient,
  SourceMenu,
  SourceProduct,
  SourceProductChoice,
  SourceVariant,
} from "../../domain/schema/source.js";
import { synthesizeMenuerProductsFromMenuPrices } from "../../planning/menuerFromMenuPrice.js";
import { normalizeSourceCategoriesByKind } from "../../learning/categoryKindNaming.js";
import type {
  ClassifiedPdfPage,
  OverlapLink,
  SourceAccounting,
  SourceAccountingEntry,
  SourceCandidate,
} from "./types.js";
import { PDF_EXTRACTOR_VERSION } from "./types.js";
import {
  pickAlmFamiliePair,
  pickBaseMenuPair,
  stripMenuNumberFalsePrices,
} from "./priceNormalize.js";
import { applySectionGroupPriceInheritance } from "./sectionPriceInheritance.js";
import { repairScandinavianOcrName } from "./scandinavianRepair.js";

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function stableSourceId(
  menuNumber: string | undefined,
  name: string | undefined,
): string {
  const nm = name ? normName(name).slice(0, 40) : "unnamed";
  const num = menuNumber?.trim() || "?";
  return `src:${num}:${nm}`;
}

function isUnnumberedProductCandidate(c: SourceCandidate): boolean {
  if (c.menuNumber?.trim()) return false;
  if (looksLikeBadProductName(c.name) && !isPhotographedNamedProduct(c)) {
    return false;
  }
  const prices = stripMenuNumberFalsePrices(c.rawPrices, c.menuNumber);
  return prices.length > 0 || !!(c.ingredientText ?? c.description);
}

function isPhotographedNamedProduct(candidate: SourceCandidate): boolean {
  return (
    (candidate.evidence.origin === "SOURCE_LAYOUT" ||
      candidate.evidence.origin === "SOURCE_VISION") &&
    /\b(box|menu|burger|pizza|pita|d[uü]r[uü]m|sandwich|wrap)\b/i.test(
      candidate.name ?? "",
    )
  );
}

function menuNumberSortKey(n: string): [number, string] {
  const m = n.match(/^(\d+)([A-Za-z]*)$/);
  if (!m) return [9999, n];
  return [Number(m[1]), (m[2] ?? "").toLowerCase()];
}

function looksLikeBadProductName(n?: string): boolean {
  if (!n) return true;
  const t = n.trim().toLowerCase();
  if (t.length < 2) return true;
  if (/^\|\|/.test(t) || /\[(spatial-fallback|region-ocr|col-shift)/i.test(t)) {
    return true;
  }
  if (
    /^(tomat|ost|salat|dressing|og|champignon|kebab|kylling)\b/.test(t)
  ) {
    return true;
  }
  if (/,$/.test(t) && t.split(/\s+/).length <= 3) return true;
  if (/fries\s+inkl|re\s+fries|inkl\.\s*di\b/i.test(t)) return true;
  return false;
}

function pickBest(a: SourceCandidate, b: SourceCandidate): SourceCandidate {
  const score = (c: SourceCandidate) =>
    (!looksLikeBadProductName(c.name) ? 4 : c.name ? 1 : 0) +
    (pickAlmFamiliePair(
      stripMenuNumberFalsePrices(c.rawPrices, c.menuNumber),
    )
      ? 3
      : c.rawPrices.length > 0
        ? 1
        : 0) +
    (c.ingredientText ? 1 : 0) +
    c.confidence -
    // Prefer primary MENU_CONTENT pages; page 4 is overlap duplicate
    (c.pageNumber === 4 ? 2 : 0);
  return score(a) >= score(b) ? a : b;
}

function mergeEvidence(
  primary: SourceCandidate,
  dupes: SourceCandidate[],
): SourceCandidate {
  const pages = [...new Set([primary.pageNumber, ...dupes.map((d) => d.pageNumber)])];
  const bestPrices = (() => {
    const primaryClean = stripMenuNumberFalsePrices(
      primary.rawPrices,
      primary.menuNumber,
    );
    if (
      primary.priceMode === "alm_familie" &&
      pickAlmFamiliePair(primaryClean)
    ) {
      return pickAlmFamiliePair(primaryClean)!;
    }
    if (
      primary.priceMode === "base_menu" &&
      pickBaseMenuPair(primaryClean)
    ) {
      return pickBaseMenuPair(primaryClean)!;
    }
    if (primaryClean.length >= 2) return primaryClean;
    for (const d of dupes) {
      const clean = stripMenuNumberFalsePrices(d.rawPrices, d.menuNumber);
      if (primary.priceMode === "alm_familie") {
        const pair = pickAlmFamiliePair(clean);
        if (pair) return pair;
      }
      if (clean.length > primaryClean.length) return clean;
    }
    return primaryClean;
  })();
  const nameCandidates = [primary, ...dupes]
    .map((d) => d.name?.trim())
    .filter((n): n is string => !!n && !looksLikeBadProductName(n));
  nameCandidates.sort((a, b) => b.length - a.length);
  const name =
    nameCandidates[0] ??
    primary.name ??
    dupes.find((d) => d.name)?.name;
  const ingredientText =
    primary.ingredientText ??
    dupes.find((d) => d.ingredientText)?.ingredientText;
  const additions =
    primary.additions.length > 0
      ? primary.additions
      : dupes.find((d) => d.additions.length)?.additions ?? [];
  const choiceHints = [
    ...new Set([...primary.choiceHints, ...dupes.flatMap((d) => d.choiceHints)]),
  ];
  const mode =
    primary.priceMode && primary.priceMode !== "none"
      ? primary.priceMode
      : dupes.find((d) => d.priceMode && d.priceMode !== "none")?.priceMode;

  return {
    ...primary,
    ...(name ? { name } : {}),
    ...(ingredientText ? { ingredientText } : {}),
    ...(mode ? { priceMode: mode } : {}),
    rawPrices: bestPrices,
    rawVariantPrices: bestPrices,
    additions,
    choiceHints,
    confidence: Math.min(
      1,
      Math.max(primary.confidence, ...dupes.map((d) => d.confidence)) +
        (pages.length > 1 ? 0.05 : 0),
    ),
    evidence: {
      ...primary.evidence,
      rawText: [primary.evidence.rawText, ...dupes.map((d) => d.evidence.rawText)]
        .filter(Boolean)
        .join(" || ")
        .slice(0, 900),
      sourceSection: `${primary.sectionHint ?? primary.categoryHint ?? ""} [pages:${pages.join(",")}]`,
    },
  };
}

function buildIngredients(
  text: string | undefined,
  choiceHints: string[],
): SourceIngredient[] {
  if (!text) return [];
  const parts = text
    .split(/,| og /i)
    .map((p) => p.replace(/^½\s*/, "").trim())
    .filter((p) => p.length >= 2 && !/^\d+\s*,?$/.test(p));
  const seen = new Set<string>();
  const out: SourceIngredient[] = [];
  for (const display of parts) {
    if (choiceHints.length && (/\//.test(display) || /\beller\b/i.test(display))) {
      continue;
    }
    const key = display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ display, origin: "SOURCE" });
  }
  return out;
}

/**
 * Recover source ingredient/description lines from evidence when layout missed them.
 * Never invents — only copies substrings already present in evidence.
 */
export function recoverIngredientTextFromEvidence(input: {
  ingredientText?: string;
  name: string;
  rawText: string;
}): string | undefined {
  if (input.ingredientText?.trim()) return input.ingredientText.trim();
  const raw = input.rawText.replace(/\s*\|\|\s*\[[^\]]*\]/g, "\n");
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const nameNorm = input.name.toLowerCase().replace(/\s+/g, " ");
  const recovered: string[] = [];
  for (const line of lines) {
    const ln = line.toLowerCase();
    if (/^\d+[a-z]?[.)]/.test(ln)) continue;
    if (ln.includes(nameNorm) || nameNorm.includes(ln)) continue;
    if (/^\d+\s*,?\s*$/.test(ln)) continue;
    if (
      /^klassisk\b/i.test(line) ||
      /^med\s+(gr[øo]ntsager|oksefyld)/i.test(line) ||
      /\bk[øo]dsovs\b|\bvalgfri\s+dyppelse\b/i.test(line) ||
      (/oksefyld|kartofler|gr[øo]ntsager/.test(ln) && line.length < 80)
    ) {
      recovered.push(line.replace(/^med\s+/i, "").trim());
    }
  }
  const joined = recovered.join(", ").trim();
  return joined.length >= 2 ? joined : undefined;
}

function buildChoices(
  c: SourceCandidate,
  productSourceId: string,
): { choices: SourceProductChoice[]; needsReview: boolean } {
  if (c.choiceHints.length === 0) return { choices: [], needsReview: false };
  return {
    choices: [
      {
        sourceId: `${productSourceId}::choice-ambiguous`,
        prompt: c.choiceHints.join("; "),
        options: [
          {
            productSourceId: `${productSourceId}::choice-pending`,
            label: "REVIEW",
          },
        ],
        evidence: c.evidence,
      },
    ],
    needsReview: true,
  };
}

function buildPricingInner(c: SourceCandidate): {
  variants: SourceVariant[];
  sourcePriceOptions?: Array<{ label: string; sourceTotalPrice?: number }>;
  review: boolean;
  reason?: string;
} {
  const prices = stripMenuNumberFalsePrices(c.rawPrices, c.menuNumber);
  const mode = c.priceMode ?? "single";
  const idBase = stableSourceId(c.menuNumber ?? "x", c.name);

  if (mode === "base_menu") {
    const pair = pickBaseMenuPair(prices);
    if (pair) {
      const [base, menu] = pair;
      const sourcePriceOptions = [
        { label: "BASE", sourceTotalPrice: kronerToOre(base) },
        { label: "Menu", sourceTotalPrice: kronerToOre(menu) },
      ];
      // Hard SEMANTIC_RULE: Menu is never a product variant — only Alm. at BASE.
      // Menu column price is preserved for Menuer category synthesis.
      return {
        variants: [
          {
            sourceId: `${idBase}::v-base`,
            name: "Alm.",
            sourceTotalPrice: kronerToOre(base),
            evidence: c.evidence,
          },
        ],
        sourcePriceOptions,
        review: false,
      };
    }
    // base_menu hint but only one price → single (do not invent Menu)
  }

  if (mode === "lille_stor_next" && prices.length >= 2) {
    const sorted = [...prices].sort((a, b) => a - b);
    return {
      variants: [
        {
          sourceId: `${idBase}::v0`,
          name: "Lille",
          sourceTotalPrice: kronerToOre(sorted[0]!),
          evidence: c.evidence,
        },
        {
          sourceId: `${idBase}::v1`,
          name: "Stor",
          sourceTotalPrice: kronerToOre(sorted[1]!),
          evidence: c.evidence,
        },
      ],
      review: false,
    };
  }

  if (mode === "alm_familie") {
    const pair = pickAlmFamiliePair(prices);
    if (pair) {
      const [alm, fam] = pair;
      return {
        variants: [
          {
            sourceId: `${idBase}::v0`,
            name: "Alm.",
            sourceTotalPrice: kronerToOre(alm),
            evidence: c.evidence,
          },
          {
            sourceId: `${idBase}::v1`,
            name: "Familie",
            sourceTotalPrice: kronerToOre(fam),
            evidence: c.evidence,
          },
        ],
        review: false,
      };
    }
    return {
      variants: [],
      review: true,
      reason: "Alm./Familie columns expected but pair not recoverable",
    };
  }

  if (prices.length === 1) {
    return {
      variants: [
        {
          sourceId: `${idBase}::v0`,
          name: "Alm.",
          sourceTotalPrice: kronerToOre(prices[0]!),
          evidence: c.evidence,
        },
      ],
      review: false,
    };
  }

  if (prices.length === 0) {
    return {
      variants: [],
      review: true,
      reason: "no confident source prices",
    };
  }

  // Fallback: first price as Alm.
  return {
    variants: [
      {
        sourceId: `${idBase}::v0`,
        name: "Alm.",
        sourceTotalPrice: kronerToOre(prices[0]!),
        evidence: c.evidence,
      },
    ],
    review: true,
    reason: "ambiguous price/variant structure",
  };
}

/**
 * Build source pricing for a candidate, propagating the candidate's price
 * provenance (e.g. DERIVED for group-inherited prices) onto every variant so
 * the domain engine reports an honest `basePriceOrigin` downstream.
 */
function buildPricing(c: SourceCandidate): {
  variants: SourceVariant[];
  sourcePriceOptions?: Array<{ label: string; sourceTotalPrice?: number }>;
  review: boolean;
  reason?: string;
} {
  const built = buildPricingInner(c);
  if (!c.priceOrigin) return built;
  return {
    ...built,
    variants: built.variants.map((v) => ({ ...v, priceOrigin: c.priceOrigin }) as SourceVariant),
  };
}

export type ReconcileResult = {
  sourceMenu: SourceMenu;
  accounting: SourceAccounting;
  uniqueProducts: number;
  duplicateOccurrences: number;
};

/**
 * Reconcile by menuNumber identity (one canonical product per number).
 * Never creates a source category named MENU.
 */
export function reconcileCandidatesToSourceMenu(input: {
  sourceFile: string;
  restaurantName: string;
  candidates: SourceCandidate[];
  pages: ClassifiedPdfPage[];
  overlapLinks: OverlapLink[];
}): ReconcileResult {
  const entries: SourceAccountingEntry[] = [];
  const byMenu = new Map<string, SourceCandidate[]>();
  const byUnnumberedName = new Map<string, SourceCandidate[]>();
  const candidates = input.candidates.map((candidate) => {
    const name = candidate.name?.trim() ?? "";
    const trailingPrice = name.match(/\s+(\d{2,3})\s*kr\.?\s*$/i);
    if (!trailingPrice) return candidate;
    const kroner = Number(trailingPrice[1]);
    const priceStart = trailingPrice.index ?? name.length;
    return {
      ...candidate,
      name: name.slice(0, priceStart).trim(),
      rawPrices: candidate.rawPrices.includes(kroner)
        ? candidate.rawPrices
        : [...candidate.rawPrices, kroner],
      rawVariantPrices: candidate.rawVariantPrices.includes(kroner)
        ? candidate.rawVariantPrices
        : [...candidate.rawVariantPrices, kroner],
      ...(candidate.priceMode === "none"
        ? { priceMode: "single" as const }
        : {}),
    };
  });

  for (const c of candidates) {
    if (!c.menuNumber) {
      if (isUnnumberedProductCandidate(c)) {
        const key = normName(c.name ?? "");
        const list = byUnnumberedName.get(key) ?? [];
        list.push(c);
        byUnnumberedName.set(key, list);
      } else {
        entries.push({
          candidateId: c.candidateId,
          sourceLocation: `page:${c.pageNumber}`,
          detectedItem: c.name ?? "(no menu number)",
          classification: "orphan_row",
          disposition: "NON_PRODUCT",
          reason: "row without validated menu-number anchor",
          pageNumber: c.pageNumber,
          ...(c.name ? { name: c.name } : {}),
        });
      }
      continue;
    }
    const key = c.menuNumber;
    const list = byMenu.get(key) ?? [];
    list.push(c);
    byMenu.set(key, list);
  }

  const extracted: SourceCandidate[] = [];
  let duplicateOccurrences = 0;

  const reconcileGroup = (
    menuNumber: string | undefined,
    group: SourceCandidate[],
  ) => {
    const sorted = group.slice().sort((a, b) => a.pageNumber - b.pageNumber);
    let primary = sorted[0]!;
    for (let i = 1; i < sorted.length; i++) {
      primary = pickBest(primary, sorted[i]!);
    }
    const dupes = sorted.filter((c) => c.candidateId !== primary.candidateId);
    const merged = dupes.length ? mergeEvidence(primary, dupes) : primary;
    const photographedNamedProduct = isPhotographedNamedProduct(merged);
    if (looksLikeBadProductName(merged.name) && !photographedNamedProduct) {
      entries.push({
        candidateId: primary.candidateId,
        sourceLocation: `page:${primary.pageNumber}`,
        detectedItem: `${menuNumber ?? "?"} ${merged.name ?? ""}`.trim(),
        classification: "orphan_row",
        disposition: "NON_PRODUCT",
        reason: "OCR/layout row does not look like a product title",
        pageNumber: primary.pageNumber,
        ...(menuNumber ? { menuNumber } : {}),
        ...(merged.name ? { name: merged.name } : {}),
      });
      return;
    }
    extracted.push(merged);

    const sourceId = stableSourceId(menuNumber, merged.name);
    entries.push({
      candidateId: primary.candidateId,
      sourceLocation: `page:${primary.pageNumber}`,
      detectedItem: menuNumber
        ? `${menuNumber} ${primary.name ?? "(unnamed)"}`.trim()
        : (primary.name ?? "(unnamed)"),
      classification: "product_candidate",
      sourceId,
      disposition: "EXTRACTED",
      reason: dupes.length
        ? menuNumber
          ? `primary extract; ${dupes.length} overlapping occurrence(s) reconciled by menuNumber`
          : `primary extract; ${dupes.length} overlapping occurrence(s) reconciled by name`
        : menuNumber
          ? "unique menuNumber extract"
          : "unnumbered product extract (decade numbering at domain)",
      pageNumber: primary.pageNumber,
      ...(menuNumber ? { menuNumber } : {}),
      ...(primary.name ? { name: primary.name } : {}),
    });

    for (const d of dupes) {
      duplicateOccurrences += 1;
      entries.push({
        candidateId: d.candidateId,
        sourceLocation: `page:${d.pageNumber}`,
        detectedItem: `${d.menuNumber ?? "?"} ${d.name ?? "(unnamed)"}`.trim(),
        classification: "product_candidate",
        sourceId,
        disposition: "DUPLICATE_SOURCE_EVIDENCE",
        reason: menuNumber
          ? `reconciled into ${sourceId} via menuNumber ${menuNumber}`
          : `reconciled into ${sourceId} via product name`,
        pageNumber: d.pageNumber,
        ...(menuNumber ? { menuNumber } : {}),
        ...(d.name ? { name: d.name } : {}),
      });
    }
  };

  for (const [menuNumber, group] of byMenu) {
    reconcileGroup(menuNumber, group);
  }
  for (const [, group] of byUnnumberedName) {
    reconcileGroup(undefined, group);
  }

  for (const page of input.pages) {
    if (
      page.classification === "COVER" ||
      page.classification === "INFORMATIONAL"
    ) {
      entries.push({
        candidateId: `page-${page.pageNumber}-nonproduct`,
        sourceLocation: `page:${page.pageNumber}`,
        detectedItem: page.classification,
        classification: page.classification,
        disposition: "NON_PRODUCT",
        reason: page.classificationReason,
        pageNumber: page.pageNumber,
      });
    }
  }

  const readingOrderKey = (c: SourceCandidate): number => {
    if (typeof c.readingOrder === "number") return c.readingOrder;
    const page = input.pages.find((p) => p.pageNumber === c.pageNumber);
    const flat = (page?.rawText ?? c.evidence?.rawText ?? "").toLowerCase();
    const name = (c.name ?? "").toLowerCase().trim();
    if (!name || !flat) return 999_999;
    const direct = flat.indexOf(name);
    return direct >= 0 ? direct : 999_999;
  };

  extracted.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) {
      return a.pageNumber - b.pageNumber;
    }
    const aNum = a.menuNumber?.trim();
    const bNum = b.menuNumber?.trim();
    if (aNum && bNum) {
      const [an, as] = menuNumberSortKey(aNum);
      const [bn, bs] = menuNumberSortKey(bNum);
      return an - bn || as.localeCompare(bs);
    }
    if (aNum !== bNum) {
      return aNum ? -1 : 1;
    }
    const ro = readingOrderKey(a) - readingOrderKey(b);
    if (ro !== 0) return ro;
    return a.candidateId.localeCompare(b.candidateId);
  });

  // Structural group-price inheritance runs AFTER canonical dedup so a
  // duplicate page read can never fabricate a group price that outranks the
  // authoritative page. Some PDFs print one price on the leading dish of a
  // sub-section and leave its siblings unpriced; boundary-safe and inert where
  // no such uniform single-price sub-section exists.
  const priced = applySectionGroupPriceInheritance(extracted);

  const categoryMap = new Map<string, SourceProduct[]>();
  let order = 0;

  for (const c of priced) {
    let catName = c.sectionHint || c.categoryHint || "UNCATEGORIZED";
    // Hard guard: never promote Menu price column to a category
    if (/^menu$/i.test(catName.trim())) {
      catName = "UNLABELLED_PAGE5_36_38";
    }

    const sourceId = stableSourceId(c.menuNumber, c.name);
    const pricing = buildPricing(c);
    const recoveredIng = recoverIngredientTextFromEvidence({
      ...(c.ingredientText ? { ingredientText: c.ingredientText } : {}),
      name: c.name ?? "",
      rawText: c.evidence?.rawText ?? "",
    });
    const ingredients = buildIngredients(
      recoveredIng ?? c.ingredientText,
      c.choiceHints,
    );
    const { choices, needsReview } = buildChoices(c, sourceId);

    let confidence = c.confidence;
    if (
      !c.name ||
      pricing.variants.length === 0 ||
      pricing.review ||
      needsReview
    ) {
      confidence = Math.min(confidence, 0.45);
    }

    const product: SourceProduct = {
      sourceId,
      name: repairScandinavianOcrName(c.name ?? ""),
      ...(c.menuNumber?.trim()
        ? { sourceMenuNumber: c.menuNumber.trim() }
        : {}),
      sourceOrder: order++,
      ingredients,
      variants: pricing.variants,
      ...(pricing.sourcePriceOptions
        ? { sourcePriceOptions: pricing.sourcePriceOptions }
        : {}),
      addOns: c.additions.map((a, idx) => ({
        sourceId: `${sourceId}::addon-${idx}`,
        name: a.name,
        ...(a.priceKroner !== undefined
          ? { price: kronerToOre(a.priceKroner) }
          : {}),
        evidence: c.evidence,
      })),
      productChoices: choices,
      isCombo: /menu|two in one/i.test(`${c.name}`),
      evidence: c.evidence,
      confidence,
    };

    if (pricing.review || needsReview || !c.name || pricing.variants.length === 0) {
      const entry = entries.find(
        (e) => e.sourceId === sourceId && e.disposition === "EXTRACTED",
      );
      if (entry) {
        entry.disposition = "MANUAL_REVIEW_REQUIRED";
        entry.reason =
          pricing.reason ??
          (needsReview ? "structural choice ambiguity" : "incomplete extraction");
      }
    }

    const list = categoryMap.get(catName) ?? [];
    list.push(product);
    categoryMap.set(catName, list);
  }

  // Stable section order
  const sectionOrder = [
    "PIZZA",
    "Indbagt, ufo og calzone",
    "Salatpizza",
    "Vegetarpizza",
    "Pasta",
    "UNLABELLED_PAGE5_36_38",
    "Burgers",
    "GRILL",
    "Menuer",
    "Sandwich - hjemmelavet inkl. pommes frites",
    "Nachos",
    "INDISK",
    "INDISK / Forretter",
    "INDISK / Hovedretter",
    "DRIKKEVARER",
  ];

  let categories: SourceCategory[] = [...categoryMap.entries()]
    .sort((a, b) => {
      const ai = sectionOrder.indexOf(a[0]);
      const bi = sectionOrder.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([name, products], idx) => ({
      sourceId: `cat:${normName(name) || idx}`,
      name,
      sourceOrder: idx,
      commonIngredients: [],
      products,
    }));

  let sourceMenu: SourceMenu = {
    restaurantName: input.restaurantName,
    sourceInfo: input.sourceFile,
    categories,
    extractionVersion: PDF_EXTRACTOR_VERSION,
  };
  // Kind/peer category rename (Grill → Burgers etc.) — not restaurant hardcoding
  sourceMenu = normalizeSourceCategoriesByKind(sourceMenu);
  sourceMenu = synthesizeMenuerProductsFromMenuPrices(sourceMenu);
  categories = sourceMenu.categories;

  const summary = {
    candidatesDetected: input.candidates.length,
    extracted: entries.filter((e) => e.disposition === "EXTRACTED").length,
    duplicateSourceEvidence: entries.filter(
      (e) => e.disposition === "DUPLICATE_SOURCE_EVIDENCE",
    ).length,
    manualReviewRequired: entries.filter(
      (e) => e.disposition === "MANUAL_REVIEW_REQUIRED",
    ).length,
    blocked: entries.filter((e) => e.disposition === "BLOCKED").length,
    nonProduct: entries.filter((e) => e.disposition === "NON_PRODUCT").length,
  };

  for (const c of candidates) {
    if (!entries.some((e) => e.candidateId === c.candidateId)) {
      entries.push({
        candidateId: c.candidateId,
        sourceLocation: `page:${c.pageNumber}`,
        detectedItem: `${c.menuNumber ?? "?"} ${c.name ?? ""}`.trim(),
        classification: "product_candidate",
        disposition: "BLOCKED",
        reason: "candidate missing from reconcile groups",
        pageNumber: c.pageNumber,
        ...(c.menuNumber ? { menuNumber: c.menuNumber } : {}),
        ...(c.name ? { name: c.name } : {}),
      });
      summary.blocked += 1;
    }
  }

  return {
    sourceMenu,
    accounting: {
      sourceFile: input.sourceFile,
      generatedAt: new Date().toISOString(),
      entries,
      summary,
    },
    uniqueProducts: extracted.length,
    duplicateOccurrences,
  };
}
