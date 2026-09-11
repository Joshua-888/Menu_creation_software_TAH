import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { repairScandinavianOcrName } from "../src/extraction/pdf/renderedFallback.js";

const KEEP = new Set([
  "D-MENU-OPTION",
  "D-CHOICE-1",
  "D-CHOICE-2",
  "D-CHOICE-3",
  "D-CHOICE-4",
  "D-CHOICE-5",
  "D-CHOICE-6",
  "D-CAT-PASTA",
  "D-CAT-38",
]);

const srcPath = "runs/m5h-veroni/human-review-final.json";
if (!existsSync(srcPath)) {
  throw new Error(`missing ${srcPath}`);
}
const raw = JSON.parse(readFileSync(srcPath, "utf8")) as {
  generatedAt?: string;
  decisions: Array<{ id: string }>;
};
const decisions = raw.decisions.filter((d) => KEEP.has(d.id));
if (decisions.length !== 9) {
  throw new Error(`expected 9 core decisions, got ${decisions.length}`);
}
mkdirSync("fixtures/veroni", { recursive: true });
const out = {
  generatedAt: raw.generatedAt ?? new Date().toISOString(),
  frozenFor: "M6",
  note: "Accepted 9 semantic decisions from M5H; recommendations are system-only. Extra empty-destination category prompts are excluded.",
  decisions,
};
writeFileSync(
  "fixtures/veroni/m6-human-review-final.json",
  JSON.stringify(out, null, 2),
  "utf8",
);
console.log("wrote fixtures/veroni/m6-human-review-final.json", decisions.length);

const moji = Buffer.from([0xc3, 0x83, 0xcb, 0x9c, 0x6c]).toString("utf8");
console.log("repair moji", JSON.stringify(moji), "→", JSON.stringify(repairScandinavianOcrName(moji)));
console.log("repair A~l →", JSON.stringify(repairScandinavianOcrName("A~l")));
