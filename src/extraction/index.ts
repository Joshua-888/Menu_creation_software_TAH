export type { MenuExtractor, MenuSource } from "./types.js";
export {
  PdfSourceAdapter,
  ingestPdf,
  classifyPdfPages,
  detectOverlappingPages,
  detectSourceCandidates,
  detectSourceCandidatesLayout,
  reconcileCandidatesToSourceMenu,
  loadVeroniGoldenFixture,
  reconcileAgainstGolden,
  type PdfExtractionResult,
} from "./pdf/index.js";
