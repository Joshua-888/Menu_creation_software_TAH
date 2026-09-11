export { PdfSourceAdapter, type PdfExtractionResult } from "./adapter.js";
export { ingestPdf, rebuildLines } from "./ingest.js";
export { classifyPdfPage, classifyPdfPages } from "./classify.js";
export {
  detectOverlappingPages,
  extractMenuNumberTokens,
  normalizeMenuNumberToken,
} from "./overlap.js";
export {
  detectSourceCandidatesLayout,
  detectSourceCandidates,
} from "./layoutExtract.js";
export { reconcileCandidatesToSourceMenu } from "./reconcile.js";
export {
  parseKronerToken,
  parseKronerToOre,
  extractCommaPrices,
} from "./prices.js";
export {
  parseMenuNumberFromAnchor,
  extractMenuNumberFromLine,
} from "./menuNumber.js";
export {
  loadVeroniGoldenFixture,
  reconcileAgainstGolden,
  listSourceProducts,
} from "./veroniGate.js";
export type * from "./types.js";
