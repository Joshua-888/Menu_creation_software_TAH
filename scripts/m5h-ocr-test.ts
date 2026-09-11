import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";

mkdirSync("runs", { recursive: true });
const path = "fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf";
const data = new Uint8Array(readFileSync(path));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
const page = await doc.getPage(6);
const viewport = page.getViewport({ scale: 2.5 });
const canvas = createCanvas(viewport.width, viewport.height);
const ctx = canvas.getContext("2d");
try {
  const task = page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  });
  await task.promise;
  writeFileSync("runs/m5h-p6.png", canvas.toBuffer("image/png"));
  console.log("rendered", viewport.width, viewport.height);
} catch (e) {
  console.error("render fail", e);
  process.exit(1);
}

// Band around y=636 in PDF space → canvas
const ay = 636;
const cy = viewport.height - ay * 2.5;
const bandTop = Math.max(0, cy - 40);
const bandH = 80;
const strip = createCanvas(viewport.width, bandH);
const sctx = strip.getContext("2d");
sctx.drawImage(canvas, 0, bandTop, viewport.width, bandH, 0, 0, viewport.width, bandH);
writeFileSync("runs/m5h-p6-band.png", strip.toBuffer("image/png"));

const worker = await createWorker("eng");
const { data: { text } } = await worker.recognize(strip.toBuffer("image/png"));
await worker.terminate();
console.log("OCR:", JSON.stringify(text));
try {
  // pdfjs-dist versions differ — destroy may be missing
  (doc as { destroy?: () => void | Promise<void> }).destroy?.();
} catch {
  /* ignore cleanup variance */
}
console.log("cleanup ok");
