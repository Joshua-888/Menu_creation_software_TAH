import type { SourceMenu } from "../../domain/schema/source.js";
import type { MenuExtractor, MenuSource } from "../types.js";
import { ingestMenuImage } from "../image/ocrIngest.js";
import { classifyPdfPages } from "./classify.js";
import { ingestPdf } from "./ingest.js";
import { detectSourceCandidatesLayout } from "./layoutExtract.js";
import { detectNamePriceCandidates } from "./namePriceExtract.js";
import { detectOverlappingPages } from "./overlap.js";
import {
  applyRenderedPageFallbackAsync,
  hydrateImageOnlyPagesWithOcr,
} from "./renderedFallback.js";
import {
  reconcileCandidatesToSourceMenu,
  type ReconcileResult,
} from "./reconcile.js";
import type {
  ClassifiedPdfPage,
  OverlapLink,
  SourceAccounting,
  SourceCandidate,
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

function mergeCandidates(
  primary: SourceCandidate[],
  secondary: SourceCandidate[],
): SourceCandidate[] {
  if (!secondary.length) return primary;
  if (!primary.length) return secondary;
  const named = new Set(
    primary
      .map((c) => (c.name ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const out = [...primary];
  for (const c of secondary) {
    const n = (c.name ?? "").trim().toLowerCase();
    if (n && named.has(n)) continue;
    out.push(c);
  }
  return out;
}

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
    if (source.kind !== "pdf" && source.kind !== "image") {
      throw new Error("PdfSourceAdapter only accepts kind=pdf|image");
    }

    let classified: ClassifiedPdfPage[];
    let pageCount: number;
    const sourceFile = source.filePath;

    if (source.kind === "image") {
      const ingested = await ingestMenuImage(sourceFile);
      classified = ingested.pages;
      pageCount = ingested.pageCount;
    } else {
      const ingested = await ingestPdf(sourceFile);
      classified = classifyPdfPages(ingested.pages);
      classified = await hydrateImageOnlyPagesWithOcr(classified, sourceFile);
      pageCount = ingested.pageCount;
    }

    const { links, pages } = detectOverlappingPages(classified);
    const layout = await applyRenderedPageFallbackAsync(
      detectSourceCandidatesLayout(pages, sourceFile),
      pages,
    );
    const named = detectNamePriceCandidates(pages, sourceFile);
    const candidates = mergeCandidates(layout, named);
    const reconciled: ReconcileResult = reconcileCandidatesToSourceMenu({
      sourceFile,
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
      pageCount,
      sourceFile,
    };
  }
}
