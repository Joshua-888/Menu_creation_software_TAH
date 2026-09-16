/**
 * Ingest a menu photo using complementary OCR segmentation modes.
 *
 * Photos are not flat PDF pages: a small perspective angle makes the generic
 * three-pixel PDF Y bucket split one printed row into many one-word rows.
 * Tesseract baselines provide enough local geometry to deskew those words
 * deterministically before the shared candidate detectors run.
 */

import { readFileSync } from "node:fs";
import { createWorker, PSM, type Line, type Word } from "tesseract.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { repairScandinavianOcrName } from "../pdf/scandinavianRepair.js";
import { rebuildLines } from "../pdf/ingest.js";
import type {
  ClassifiedPdfPage,
  PdfPageLine,
  PdfTextItem,
} from "../pdf/types.js";

export type ImageOcrDiagnostics = {
  OCR_CHARACTER_CONFIDENCE: number;
  TEXT_GARBAGE_RATIO: number;
  PRICE_ANCHOR_COUNT: number;
  PRODUCT_ROW_CANDIDATE_COUNT: number;
  OCR_PASS_COUNT: number;
  escalationRecommended: boolean;
  reasons: string[];
};

type OcrPass = {
  confidence: number;
  lines: Line[];
  words: Word[];
  scale: number;
};

const PRICE_ANCHOR_RE =
  /(?:\bkr\.?\s*\d{2,3}\b|\b\d{2,3}\s*kr\.?\b|\b\d{2,3}\s*[,.-]\s*$)/i;
const PRODUCT_WORD_RE =
  /\b(burger|kebab|d[uü]r[uü]m|pita|sandwich|wrap|menu|box|nuggets?|pomfrit|pizza|pasta|curry|wok|sushi)\b/i;

function preprocessToPng(img: Awaited<ReturnType<typeof loadImage>>): Buffer {
  const scale = 2.4;
  const canvas = createCanvas(
    Math.round(img.width * scale),
    Math.round(img.height * scale),
  );
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const gray =
      0.299 * imageData.data[i]! +
      0.587 * imageData.data[i + 1]! +
      0.114 * imageData.data[i + 2]!;
    const value =
      gray < 145
        ? Math.max(0, gray * 0.5)
        : Math.min(255, 255 - (255 - gray) * 0.15);
    imageData.data[i] = value;
    imageData.data[i + 1] = value;
    imageData.data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("image/png");
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function baselineSlope(lines: Line[]): number {
  const slopes = lines
    .filter(
      (line) =>
        line.baseline?.has_baseline &&
        Math.abs(line.baseline.x1 - line.baseline.x0) >= 40,
    )
    .map(
      (line) =>
        (line.baseline.y1 - line.baseline.y0) /
        (line.baseline.x1 - line.baseline.x0),
    )
    .filter((slope) => Number.isFinite(slope) && Math.abs(slope) < 0.35);
  return median(slopes);
}

function garbageRatio(text: string): number {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const garbage = tokens.filter((token) => {
    const letters = token.replace(/[^A-Za-zÆØÅæøå]/g, "");
    if (!letters) return false;
    if (letters.length <= 2) return false;
    const vowels = letters.match(/[aeiouyæøå]/gi)?.length ?? 0;
    return vowels / letters.length < 0.15 || /[^A-Za-zÆØÅæøå0-9.,'’/-]/.test(token);
  }).length;
  return garbage / tokens.length;
}

function mergeWords(passes: OcrPass[]): Word[] {
  const selected: Word[] = [];
  for (const pass of passes) {
    for (const word of pass.words) {
      const text = String(word.text ?? "").trim();
      if (!text || word.confidence < 25) continue;
      const duplicateIndex = selected.findIndex((other) => {
        const a = word.bbox;
        const b = other.bbox;
        const overlapX = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
        const overlapY = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
        const minArea = Math.max(
          1,
          Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)),
        );
        return (overlapX * overlapY) / minArea > 0.55;
      });
      if (duplicateIndex < 0) {
        selected.push(word);
      } else if (word.confidence > selected[duplicateIndex]!.confidence) {
        selected[duplicateIndex] = word;
      }
    }
  }
  return selected;
}

function deskewedLines(
  words: Word[],
  tesseractLines: Line[],
  pageHeight: number,
  scale: number,
): { items: PdfTextItem[]; lines: PdfPageLine[] } {
  const slope = baselineSlope(tesseractLines);
  const heights = words.map((word) => word.bbox.y1 - word.bbox.y0).filter((h) => h > 2);
  const tolerance = Math.max(7, median(heights) * 0.62);
  const rows: Array<{ adjustedY: number; words: Word[] }> = [];

  for (const word of words.slice().sort((a, b) => {
    const ac = (a.bbox.y0 + a.bbox.y1) / 2 - slope * a.bbox.x0;
    const bc = (b.bbox.y0 + b.bbox.y1) / 2 - slope * b.bbox.x0;
    return ac - bc || a.bbox.x0 - b.bbox.x0;
  })) {
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    const adjustedY = centerY - slope * word.bbox.x0;
    let row = rows.find((candidate) => Math.abs(candidate.adjustedY - adjustedY) <= tolerance);
    if (!row) {
      row = { adjustedY, words: [] };
      rows.push(row);
    }
    row.words.push(word);
    row.adjustedY =
      row.words.reduce(
        (sum, entry) =>
          sum +
          (entry.bbox.y0 + entry.bbox.y1) / 2 -
          slope * entry.bbox.x0,
        0,
      ) / row.words.length;
  }

  const items: PdfTextItem[] = words.map((word) => ({
    str: repairScandinavianOcrName(String(word.text).trim()),
    x: Math.round(word.bbox.x0 / scale),
    y: Math.round(pageHeight - word.bbox.y1 / scale),
    width: Math.max(1, Math.round((word.bbox.x1 - word.bbox.x0) / scale)),
    height: Math.max(1, Math.round((word.bbox.y1 - word.bbox.y0) / scale)),
    confidence: word.confidence / 100,
  }));

  const lines = rows
    .sort((a, b) => a.adjustedY - b.adjustedY)
    .map((row) => {
      const rowItems = row.words
        .slice()
        .sort((a, b) => a.bbox.x0 - b.bbox.x0)
        .map((word) => items[words.indexOf(word)]!)
        .filter(Boolean);
      return {
        y: Math.round(pageHeight - row.adjustedY / scale),
        text: rowItems.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim(),
        items: rowItems,
      };
    })
    .filter((line) => line.text.length > 0);
  return { items, lines };
}

function passScore(pass: OcrPass): number {
  const text = pass.lines.map((line) => line.text).join("\n");
  const productLines = text
    .split(/\r?\n/)
    .filter((line) => PRODUCT_WORD_RE.test(line)).length;
  const priceNumbers = pass.words.filter(
    (word) =>
      /^\d{2,3}$/.test(word.text.trim()) &&
      Number(word.text) >= 10 &&
      Number(word.text) <= 400,
  ).length;
  return productLines * 5 + priceNumbers * 2 + pass.confidence;
}

function passHasMenuStructure(pass: OcrPass): boolean {
  const text = pass.lines.map((line) => line.text).join("\n");
  const productLines = text
    .split(/\r?\n/)
    .filter((line) => PRODUCT_WORD_RE.test(line)).length;
  const priceNumbers = pass.words.filter(
    (word) =>
      /^\d{2,3}$/.test(word.text.trim()) &&
      Number(word.text) >= 10 &&
      Number(word.text) <= 400,
  ).length;
  return productLines >= 3 && priceNumbers >= 3;
}

function diagnosticsFor(passes: OcrPass[], lines: PdfPageLine[]): ImageOcrDiagnostics {
  const words = passes.flatMap((pass) => pass.words).filter((word) => word.text.trim());
  const meanConfidence = words.length
    ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length / 100
    : 0;
  const text = lines.map((line) => line.text).join("\n");
  const priceAnchors = lines.filter((line) => PRICE_ANCHOR_RE.test(line.text)).length;
  const productRows = lines.filter((line) => PRODUCT_WORD_RE.test(line.text)).length;
  const ratio = garbageRatio(text);
  const reasons: string[] = [];
  if (meanConfidence < 0.62) reasons.push("low OCR character confidence");
  if (ratio > 0.22) reasons.push("high OCR garbage ratio");
  if (priceAnchors < 2) reasons.push("too few price anchors");
  if (productRows > 0 && priceAnchors / productRows < 0.45) {
    reasons.push("product rows substantially exceed price anchors");
  }
  return {
    OCR_CHARACTER_CONFIDENCE: Number(meanConfidence.toFixed(4)),
    TEXT_GARBAGE_RATIO: Number(ratio.toFixed(4)),
    PRICE_ANCHOR_COUNT: priceAnchors,
    PRODUCT_ROW_CANDIDATE_COUNT: productRows,
    OCR_PASS_COUNT: passes.length,
    escalationRecommended: reasons.length > 0,
    reasons,
  };
}

export async function ingestMenuImage(filePath: string): Promise<{
  sourceFile: string;
  pageCount: number;
  pages: ClassifiedPdfPage[];
  diagnostics: ImageOcrDiagnostics;
}> {
  const img = await loadImage(filePath);
  const pageWidth = img.width;
  const pageHeight = img.height;
  const preprocessed = preprocessToPng(img);

  const worker = await createWorker("dan+eng");
  const passes: OcrPass[] = [];
  try {
    for (const mode of [PSM.AUTO, PSM.SPARSE_TEXT]) {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const { data } = await worker.recognize(filePath);
      passes.push({
        confidence: data.confidence / 100,
        lines: data.lines ?? [],
        words: data.words ?? [],
        scale: 1,
      });
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const { data } = await worker.recognize(preprocessed);
    passes.push({
      confidence: data.confidence / 100,
      lines: data.lines ?? [],
      words: data.words ?? [],
      scale: 2.4,
    });
  } finally {
    await worker.terminate();
  }

  const directPasses = passes.filter((pass) => pass.scale === 1);
  const selectedPasses = directPasses.some(passHasMenuStructure)
    ? directPasses
    : [passes.slice().sort((a, b) => passScore(b) - passScore(a))[0]!];
  const selected = selectedPasses[0]!;
  const words = mergeWords(
    selectedPasses.slice().sort((a, b) => passScore(b) - passScore(a)),
  );
  const reconstructed = deskewedLines(
    words,
    selectedPasses.flatMap((pass) => pass.lines),
    pageHeight,
    selected.scale,
  );
  const items = reconstructed.items;
  const lines =
    selected.scale > 1 ? rebuildLines(items) : reconstructed.lines;
  const diagnostics = diagnosticsFor(selectedPasses, lines);
  diagnostics.OCR_PASS_COUNT = passes.length;
  const page: ClassifiedPdfPage = {
    pageNumber: 1,
    width: pageWidth,
    height: pageHeight,
    rawText: lines.map((l) => l.text).join("\n"),
    items,
    lines,
    imageRef: `image:${filePath}`,
    classification: "MENU_CONTENT",
    sourceKind: "image",
    classificationReason:
      `image-multi-ocr:${items.length}-items;` +
      `confidence=${diagnostics.OCR_CHARACTER_CONFIDENCE};` +
      `garbage=${diagnostics.TEXT_GARBAGE_RATIO};` +
      `prices=${diagnostics.PRICE_ANCHOR_COUNT}`,
  };

  // Touch file so callers know bytes existed
  readFileSync(filePath);

  return {
    sourceFile: filePath,
    pageCount: 1,
    pages: [page],
    diagnostics,
  };
}
