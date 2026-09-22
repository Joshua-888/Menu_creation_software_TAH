import type { SourceAccounting } from "../extraction/pdf/types.js";

export type SourceCoverageDiagnostic = {
  id: "SOURCE_PRODUCT_COVERAGE_SUSPICIOUS";
  suspicious: boolean;
  uniqueProducts: number;
  candidateCount: number;
  priceLikeTokens: number;
  priceBearingRows: number;
  evidencePerProduct: number;
  detail: string;
};

/**
 * Raw evidence required to diagnose source→product coverage.
 *
 * Callers that hold the extraction result (portal worker, certification harness)
 * pass this through the central MenuQualityContract so the coverage signal is
 * applied uniformly to every caller of the intelligence spine.
 */
export type SourceCoverageEvidence = {
  accounting: SourceAccounting;
  uniqueProducts: number;
  rawText?: string;
  ocrRows?: readonly string[];
};

/**
 * Build the coverage evidence from an extraction result using structural typing,
 * so this module does not depend on the PDF adapter (avoids a runtime cycle) and
 * both production callers share one authoritative composition.
 */
export function sourceCoverageEvidenceFromExtraction(extraction: {
  accounting: SourceAccounting;
  uniqueProducts: number;
  pages: ReadonlyArray<{
    rawText: string;
    lines: ReadonlyArray<{ text: string }>;
  }>;
}): SourceCoverageEvidence {
  return {
    accounting: extraction.accounting,
    uniqueProducts: extraction.uniqueProducts,
    rawText: extraction.pages.map((page) => page.rawText).join("\n"),
    ocrRows: extraction.pages.flatMap((page) =>
      page.lines.map((line) => line.text),
    ),
  };
}

// Currency-marked price evidence ONLY. A bare integer (`\b\d{2,3}\b`) is NOT
// price evidence: menu numbers, portion sizes, postcodes and OCR noise all match
// it. Counting bare integers previously produced near-universal false positives
// on genuinely well-extracted menus (Veroni 6.4x, Smash 10.2x, third-merchant
// 5.3x) while adding no true-positive power, so it is excluded here. This is a
// strict reduction in suspicion — the check can never become newly suspicious
// for evidence that the previous predicate did not already flag.
const PRICE_LIKE = /(?:\bkr\.?\s*\d{2,3}\b|\b\d{2,3}\s*kr\.?\b)/gi;
const PRICE_LIKE_ROW = /(?:\bkr\.?\s*\d{2,3}\b|\b\d{2,3}\s*kr\.?\b)/i;

export function diagnoseSourceProductCoverage(
  input: SourceCoverageEvidence,
): SourceCoverageDiagnostic {
  const evidenceText = [
    input.rawText ?? "",
    ...(input.ocrRows ?? []),
    ...input.accounting.entries.map((entry) => entry.detectedItem),
  ].join("\n");
  const rows = evidenceText.split(/\r?\n/).filter((row) => row.trim().length > 0);
  const priceLikeTokens = evidenceText.match(PRICE_LIKE)?.length ?? 0;
  const priceBearingRows = rows.filter((row) => PRICE_LIKE_ROW.test(row)).length;
  const denominator = Math.max(input.uniqueProducts, 1);
  const candidateCount = input.accounting.summary.candidatesDetected;
  const evidencePerProduct = Math.max(
    priceLikeTokens,
    priceBearingRows,
    candidateCount,
  ) / denominator;
  const suspicious =
    input.uniqueProducts > 0 &&
    evidencePerProduct >= 3 &&
    Math.max(priceLikeTokens, priceBearingRows, candidateCount) >
      input.uniqueProducts;
  return {
    id: "SOURCE_PRODUCT_COVERAGE_SUSPICIOUS",
    suspicious,
    uniqueProducts: input.uniqueProducts,
    candidateCount,
    priceLikeTokens,
    priceBearingRows,
    evidencePerProduct,
    detail: suspicious
      ? `SOURCE_PRODUCT_COVERAGE_SUSPICIOUS: evidence density ${evidencePerProduct.toFixed(1)}x exceeds extracted products`
      : `Source coverage density ${evidencePerProduct.toFixed(1)}x`,
  };
}
