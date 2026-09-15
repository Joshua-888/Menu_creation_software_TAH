import type { SourceMenu } from "../../domain/schema/source.js";
import type { MenuExtractor, MenuSource } from "../types.js";
import { classifyPdfPages } from "./classify.js";
import { ingestPdf } from "./ingest.js";
import { detectSourceCandidatesLayout } from "./layoutExtract.js";
import { detectOverlappingPages } from "./overlap.js";
import { applyRenderedPageFallbackAsync, hydrateImageOnlyPagesWithOcr } from "./renderedFallback.js";
import {
  reconcileCandidatesToSourceMenu,
  type ReconcileResult,
} from "./reconcile.js";
import type {
  ClassifiedPdfPage,
  OverlapLink,
  SourceAccounting,
} from "./types.js";
import { PDF_EXTRACTOR_VERSION } from "./types.js";

export type PdfExtractionResult = {
  sourceMenu: SourceMenu;
  accounting: SourceAccounting;
  pages: ClassifiedPdfPage[];
  overlapLinks: OverlapLink[];
  uniqueProducts: number;
  duplicateOccurrences: number;
  pageCount: number;
  sourceFile: string;
};

export class PdfSourceAdapter implements MenuExtractor {
  readonly extractorVersion = PDF_EXTRACTOR_VERSION;

  constructor(
    private readonly opts?: {
      restaurantName?: string;
    },
  ) {}

  async extract(source: MenuSource): Promise<SourceMenu> {
    const full = await this.extractDetailed(source);
    return full.sourceMenu;
  }

  async extractDetailed(source: MenuSource): Promise<PdfExtractionResult> {
    if (source.kind !== "pdf") {
      throw new Error("PdfSourceAdapter only accepts kind=pdf");
    }
    const ingested = await ingestPdf(source.filePath);
    let classified = classifyPdfPages(ingested.pages);
    // Scanned / image-only PDFs have zero embedded text — OCR the page first.
    classified = await hydrateImageOnlyPagesWithOcr(
      classified,
      source.filePath,
    );
    const { links, pages } = detectOverlappingPages(classified);
    const candidates = await applyRenderedPageFallbackAsync(
      detectSourceCandidatesLayout(pages, source.filePath),
      pages,
    );
    const reconciled: ReconcileResult = reconcileCandidatesToSourceMenu({
      sourceFile: source.filePath,
      restaurantName: this.opts?.restaurantName ?? "Unknown restaurant",
      candidates,
      pages,
      overlapLinks: links,
    });

    return {
      sourceMenu: reconciled.sourceMenu,
      accounting: reconciled.accounting,
      pages,
      overlapLinks: links,
      uniqueProducts: reconciled.uniqueProducts,
      duplicateOccurrences: reconciled.duplicateOccurrences,
      pageCount: ingested.pageCount,
      sourceFile: source.filePath,
    };
  }
}
