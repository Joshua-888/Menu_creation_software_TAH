import type { SourceMenu } from "../../domain/schema/source.js";
import type { MenuExtractor, MenuSource } from "../types.js";
import { ingestMenuImage } from "../image/ocrIngest.js";
import type { ImageOcrDiagnostics } from "../image/ocrIngest.js";
import {
  configuredVisionMenuExtractor,
  type VisionMenuExtractor,
} from "../image/visionMenuExtractor.js";
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
  imageDiagnostics?: ImageOcrDiagnostics & {
    visionEscalated: boolean;
    visionExtractor?: string;
    visionError?: string;
  };
};

function candidateScore(candidate: SourceCandidate): number {
  const origin = candidate.evidence.origin;
  const originScore =
    origin === "SOURCE_VISION"
      ? 3
      : origin === "SOURCE_LAYOUT"
        ? 2
        : origin === "SOURCE_OCR"
          ? 1
          : 0;
  return (
    (candidate.rawPrices.some((price) => price > 0) ? 5 : 0) +
    (candidate.name?.trim() ? 2 : 0) +
    (candidate.ingredientText?.trim() ? 1 : 0) +
    originScore +
    candidate.confidence
  );
}

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
    if (n && named.has(n)) {
      const index = out.findIndex(
        (existing) => (existing.name ?? "").trim().toLowerCase() === n,
      );
      if (index >= 0 && candidateScore(c) > candidateScore(out[index]!)) {
        out[index] = c;
      }
      continue;
    }
    if (n) named.add(n);
    out.push(c);
  }
  return out;
}

function mergePdfCandidates(
  primary: SourceCandidate[],
  secondary: SourceCandidate[],
): SourceCandidate[] {
  if (!secondary.length) return primary;
  if (!primary.length) return secondary;
  const named = new Set(
    primary
      .map((candidate) => (candidate.name ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const out = [...primary];
  for (const candidate of secondary) {
    const name = (candidate.name ?? "").trim().toLowerCase();
    if (name && named.has(name)) continue;
    out.push(candidate);
  }
  return out;
}

export class PdfSourceAdapter implements MenuExtractor {
  readonly extractorVersion = PDF_EXTRACTOR_VERSION;

  constructor(
    private readonly opts?: {
      restaurantName?: string;
      visionMenuExtractor?: VisionMenuExtractor | null;
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
    let imageDiagnostics: PdfExtractionResult["imageDiagnostics"];
    const sourceFile = source.filePath;

    if (source.kind === "image") {
      const ingested = await ingestMenuImage(sourceFile);
      classified = ingested.pages;
      pageCount = ingested.pageCount;
      imageDiagnostics = {
        ...ingested.diagnostics,
        visionEscalated: false,
      };
    } else {
      const ingested = await ingestPdf(sourceFile);
      classified = classifyPdfPages(ingested.pages);
      classified = await hydrateImageOnlyPagesWithOcr(classified, sourceFile);
      classified = classified.map((page) => ({ ...page, sourceKind: "pdf" }));
      pageCount = ingested.pageCount;
    }

    const { links, pages } = detectOverlappingPages(classified);
    const layout = await applyRenderedPageFallbackAsync(
      detectSourceCandidatesLayout(pages, sourceFile),
      pages,
    );
    const named = detectNamePriceCandidates(pages, sourceFile);
    let candidates =
      source.kind === "image"
        ? mergeCandidates(layout, named)
        : mergePdfCandidates(layout, named);
    if (source.kind === "image" && imageDiagnostics) {
      const suspiciousLocalCoverage =
        imageDiagnostics.PRICE_ANCHOR_COUNT >= 3 &&
        candidates.length <
          Math.ceil(imageDiagnostics.PRICE_ANCHOR_COUNT * 0.65);
      if (imageDiagnostics.escalationRecommended || suspiciousLocalCoverage) {
        const vision =
          this.opts?.visionMenuExtractor === null
            ? undefined
            : this.opts?.visionMenuExtractor ?? configuredVisionMenuExtractor();
        if (vision) {
          imageDiagnostics.visionEscalated = true;
          imageDiagnostics.visionExtractor = vision.id;
          try {
            const visionCandidates = await vision.extract({
              filePath: sourceFile,
              sourceFile,
              pageNumber: 1,
            });
            // Better priced layout/vision evidence replaces matching OCR
            // garbage; unmatched evidence remains independently accountable.
            candidates = mergeCandidates(candidates, visionCandidates);
          } catch (error) {
            imageDiagnostics.visionError =
              error instanceof Error ? error.message : String(error);
          }
        }
      }
    }
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
      ...(imageDiagnostics ? { imageDiagnostics } : {}),
    };
  }
}
