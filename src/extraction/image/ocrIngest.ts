/**
 * Ingest a menu photo (JPEG/PNG/WebP) via preprocessed OCR into PDF page shape
 * so layout + name/price extractors can run.
 */

import { readFileSync } from "node:fs";
import { createWorker, PSM } from "tesseract.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { rebuildLines } from "../pdf/ingest.js";
import { repairScandinavianOcrName } from "../pdf/scandinavianRepair.js";
import type { ClassifiedPdfPage, PdfTextItem } from "../pdf/types.js";

function preprocessToPng(img: {
  width: number;
  height: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  draw: (ctx: any, w: number, h: number) => void;
}): Buffer {
  const scale = 2.4;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  img.draw(ctx, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const v =
      g < 145
        ? Math.max(0, g * 0.5)
        : Math.min(255, 255 - (255 - g) * 0.15);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("image/png");
}

export async function ingestMenuImage(filePath: string): Promise<{
  sourceFile: string;
  pageCount: number;
  pages: ClassifiedPdfPage[];
}> {
  const img = await loadImage(filePath);
  const scale = 2.4;
  const pageWidth = img.width;
  const pageHeight = img.height;
  const png = preprocessToPng({
    width: img.width,
    height: img.height,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
  });

  const worker = await createWorker("dan+eng");
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
  });
  const {
    data: { words },
  } = await worker.recognize(png);
  await worker.terminate();

  const items: PdfTextItem[] = [];
  for (const w of words ?? []) {
    const raw = String(w.text ?? "").trim();
    if (!raw) continue;
    const conf = typeof w.confidence === "number" ? w.confidence : 0;
    if (conf > 0 && conf < 30) continue;
    const box = w.bbox;
    if (!box) continue;
    const x0 = box.x0 / scale;
    const x1 = box.x1 / scale;
    const y0 = box.y0 / scale;
    const y1 = box.y1 / scale;
    const pdfY = pageHeight - y1;
    items.push({
      str: repairScandinavianOcrName(raw),
      x: Math.round(x0),
      y: Math.round(pdfY),
      width: Math.max(1, Math.round(x1 - x0)),
      height: Math.max(1, Math.round(y1 - y0)),
    });
  }

  const lines = rebuildLines(items);
  const page: ClassifiedPdfPage = {
    pageNumber: 1,
    width: pageWidth,
    height: pageHeight,
    rawText: lines.map((l) => l.text).join("\n"),
    items,
    lines,
    imageRef: `image:${filePath}`,
    classification: "MENU_CONTENT",
    classificationReason: `image-ocr:${items.length}-items`,
  };

  // Touch file so callers know bytes existed
  readFileSync(filePath);

  return {
    sourceFile: filePath,
    pageCount: 1,
    pages: [page],
  };
}
