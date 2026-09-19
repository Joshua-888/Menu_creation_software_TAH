import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";

mkdirSync("runs", { recursive: true });
const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const doc = await getDocument({
  data: new Uint8Array(readFileSync(path)),
  useSystemFonts: true,
}).promise;
const page = await doc.getPage(6);
const viewport = page.getViewport({ scale: 2.5 });
const canvas = createCanvas(viewport.width, viewport.height);
await page.render({
  canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
  viewport,
}).promise;
writeFileSync("runs/m5h-p6-full.png", canvas.toBuffer("image/png"));

const worker = await createWorker("eng");
const ocrLines: string[] = [];
for (const [label, ay] of [
  ["64", 650],
  ["65", 636],
  ["66", 623],
  ["67", 607],
  ["68", 594],
] as const) {
  const cy = viewport.height - ay * 2.5;
  const bandTop = Math.max(0, cy - 18);
  const bandH = 36;
  const strip = createCanvas(viewport.width, bandH);
  strip
    .getContext("2d")
    .drawImage(canvas, 0, bandTop, viewport.width, bandH, 0, 0, viewport.width, bandH);
  const png = strip.toBuffer("image/png");
  writeFileSync(`runs/m5h-band-${label}.png`, png);
  const {
    data: { text },
  } = await worker.recognize(png);
  ocrLines.push(`${label}: ${JSON.stringify(text.replace(/\s+/g, " ").trim())}`);
}
await worker.terminate();
try {
  // pdfjs versions differ
  (doc as { destroy?: () => void }).destroy?.();
} catch {
  /* ignore */
}
writeFileSync("runs/m5h-band-ocr.txt", ocrLines.join("\n"), "utf8");
console.log(ocrLines.join("\n"));
