import type { DecisionFeatures, DecisionType } from "./types.js";

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive source-supported decision features only — no invented facts.
 */
export function buildDecisionFeatures(input: {
  decisionType: DecisionType;
  sourceText: string;
  productName: string;
  sourceCategory?: string | null;
  destinationCategoryCandidates?: string[];
  restaurantKey: string;
  menuNumber?: string | null;
  priceOptionLabels?: string[];
  variantLabels?: string[];
  sourceConfidence?: number | null;
  ocrConfidence?: number | null;
  visualEvidenceAvailable?: boolean;
}): DecisionFeatures {
  const raw = input.sourceText;
  const norm = normalizeText(raw);
  const markers: string[] = [];
  if (/\bvalgfrit\b/i.test(raw)) markers.push("VALGFRIT");
  if (/\bvælg mellem\b/i.test(raw) || /\bvaelg mellem\b/i.test(norm)) {
    markers.push("VAELG_MELLEM");
  }
  if (/\bvælg\b/i.test(raw) || /\bvaelg\b/i.test(norm)) markers.push("VAELG");
  if (/\beller\b/i.test(raw)) markers.push("ELLER");
  // Slash alone is recorded as a structural flag, NOT as a choice marker
  const slashSeparatedOptions = /\w\s*\/\s*\w/.test(raw);

  const phrases = norm
    .split(/[^a-z0-9æøå]+/i)
    .filter((p) => p.length >= 3)
    .slice(0, 40);

  const priceLabels = input.priceOptionLabels ?? [];
  const variantLabels = input.variantLabels ?? [];
  let priceStructure: string | null = null;
  if (priceLabels.includes("BASE") && priceLabels.includes("Menu")) {
    priceStructure = "BASE_MENU";
  } else if (variantLabels.includes("Alm.") && variantLabels.includes("Familie")) {
    priceStructure = "ALM_FAMILIE";
  } else if (variantLabels.includes("Lille") && variantLabels.includes("Stor")) {
    priceStructure = "LILLE_STOR";
  } else if (priceLabels.length || variantLabels.length) {
    priceStructure = "SINGLE_OR_OTHER";
  }

  const productTypeHints: string[] = [];
  const nameNorm = normalizeText(input.productName);
  if (/pita|pitabrod|durum|rulle/.test(nameNorm)) {
    productTypeHints.push("PITA_DURUM");
  }
  if (/hvidlogs|hvidloegs|garlic/.test(nameNorm)) {
    productTypeHints.push("GARLIC_BREAD");
  }

  const exactCaseKey = [
    input.decisionType,
    input.restaurantKey,
    input.menuNumber ?? "",
    normalizeText(input.productName),
    markers.sort().join("+"),
    priceStructure ?? "",
  ].join("|");

  return {
    decisionType: input.decisionType,
    normalizedPhrases: phrases,
    explicitChoiceMarkers: markers,
    slashSeparatedOptions,
    orMarkers: markers.includes("ELLER"),
    chooseMarkers:
      markers.includes("VAELG") || markers.includes("VAELG_MELLEM"),
    optionalMarkers: markers.includes("VALGFRIT"),
    priceStructure,
    priceOptionLabels: priceLabels,
    variantLabels,
    optionCount: Math.max(priceLabels.length, variantLabels.length),
    sourceCategory: input.sourceCategory ?? null,
    destinationCategoryCandidates: input.destinationCategoryCandidates ?? [],
    hasExplicitPricePerOption: priceLabels.length >= 2,
    hasSingleSharedPrice: priceLabels.length <= 1 && variantLabels.length <= 1,
    hasMissingOptionPrices: false,
    productTypeHints,
    contextBefore: null,
    contextAfter: null,
    sourceConfidence: input.sourceConfidence ?? null,
    visualEvidenceAvailable: input.visualEvidenceAvailable ?? false,
    ocrConfidence: input.ocrConfidence ?? null,
    exactCaseKey,
    restaurantKey: input.restaurantKey,
  };
}

export function featureSimilarity(
  a: DecisionFeatures,
  b: DecisionFeatures,
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;
  if (a.decisionType === b.decisionType) {
    breakdown.decisionType = 3;
    score += 3;
  }
  if (a.exactCaseKey === b.exactCaseKey) {
    breakdown.exactCase = 10;
    score += 10;
  }
  const markersA = new Set(a.explicitChoiceMarkers);
  const markersB = new Set(b.explicitChoiceMarkers);
  const inter = [...markersA].filter((m) => markersB.has(m)).length;
  breakdown.markers = inter;
  score += inter * 2;
  if (a.priceStructure && a.priceStructure === b.priceStructure) {
    breakdown.priceStructure = 2;
    score += 2;
  }
  if (
    a.restaurantKey &&
    a.restaurantKey === b.restaurantKey
  ) {
    breakdown.restaurant = 1.5;
    score += 1.5;
  }
  if (
    a.sourceCategory &&
    a.sourceCategory === b.sourceCategory
  ) {
    breakdown.category = 1;
    score += 1;
  }
  if (a.slashSeparatedOptions === b.slashSeparatedOptions) {
    breakdown.slash = 0.5;
    score += 0.5;
  }
  return { score, breakdown };
}
