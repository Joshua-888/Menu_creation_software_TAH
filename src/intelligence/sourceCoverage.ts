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

const PRICE_LIKE = /(?:\bkr\.?\s*\d{2,3}\b|\b\d{2,3}\s*kr\.?\b|\b\d{2,3}\b)/gi;
const PRICE_LIKE_ROW = /(?:\bkr\.?\s*\d{2,3}\b|\b\d{2,3}\s*kr\.?\b|\b\d{2,3}\b)/i;

export function diagnoseSourceProductCoverage(input: {
  accounting: SourceAccounting;
  uniqueProducts: number;
  rawText?: string;
  ocrRows?: readonly string[];
}): SourceCoverageDiagnostic {
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
