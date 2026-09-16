import type { SourceEvidence } from "../../domain/evidence.js";

export type PageClass =
  | "COVER"
  | "MENU_CONTENT"
  | "INFORMATIONAL"
  | "DUPLICATE_OR_OVERLAPPING"
  | "UNKNOWN";

export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** OCR confidence normalized to 0..1; absent for embedded PDF text. */
  confidence?: number;
};

export type PdfPageLine = {
  y: number;
  text: string;
  items: PdfTextItem[];
};

export type IngestedPdfPage = {
  pageNumber: number;
  width: number;
  height: number;
  rawText: string;
  items: PdfTextItem[];
  lines: PdfPageLine[];
  imageRef?: string;
};

export type ClassifiedPdfPage = IngestedPdfPage & {
  classification: PageClass;
  classificationReason: string;
  sourceKind?: "pdf" | "image";
};

export type OverlapLink = {
  pageA: number;
  pageB: number;
  textSimilarity: number;
  sharedMenuNumbers: string[];
  sharedProductNames: string[];
  reason: string;
};

export type CandidateDisposition =
  | "EXTRACTED"
  | "DUPLICATE_SOURCE_EVIDENCE"
  | "MANUAL_REVIEW_REQUIRED"
  | "BLOCKED"
  | "NON_PRODUCT";

export type SourceCandidate = {
  candidateId: string;
  pageNumber: number;
  menuNumber?: string;
  name?: string;
  description?: string;
  ingredientText?: string;
  rawPrices: number[];
  rawVariantNames: string[];
  rawVariantPrices: number[];
  /** Spatial price-column mode for this product row. */
  priceMode?:
    | "alm_familie"
    | "lille_stor_next"
    | "base_menu"
    | "single"
    | "none";
  categoryHint?: string;
  sectionHint?: string;
  additions: Array<{ name: string; priceKroner?: number }>;
  choiceHints: string[];
  confidence: number;
  evidence: SourceEvidence;
  rawLineBundle: string;
  /** Left-to-right / top-to-bottom position when the card has no printed numbers. */
  readingOrder?: number;
};

export type SourceAccountingEntry = {
  candidateId: string;
  sourceLocation: string;
  detectedItem: string;
  classification: string;
  sourceId?: string;
  disposition: CandidateDisposition;
  reason: string;
  pageNumber: number;
  menuNumber?: string;
  name?: string;
};

export type SourceAccounting = {
  sourceFile: string;
  generatedAt: string;
  entries: SourceAccountingEntry[];
  summary: {
    candidatesDetected: number;
    extracted: number;
    duplicateSourceEvidence: number;
    manualReviewRequired: number;
    blocked: number;
    nonProduct: number;
  };
};

export const PDF_EXTRACTOR_VERSION = "pdf-source-adapter@1.2.0-multi-evidence";
