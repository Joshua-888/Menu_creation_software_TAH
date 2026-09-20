/**
 * WP0 — Blind-pilot harness (NEW_MERCHANT_BLIND_PILOT_V1)
 *
 * Runs a frozen raw source (PDF/image) through the SAME production pipeline
 * used by portal Create and certification (runRawSourceCertification):
 *   RAW bytes -> PdfSourceAdapter -> domain engine -> runMenuIntelligence -> quality
 *
 * No merchant-specific branches. No pre-tuning. Dumps a full diagnostic JSON
 * package per merchant for offline supervisor audit.
 *
 * Usage:
 *   tsx scripts/pilot-run-merchant.ts <restaurantName> <restaurantKey> <filePath> <pdf|image> <outJsonPath>
 */
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { runRawSourceCertification } from "../src/certification/runRawCertification.js";

async function main() {
  const [restaurantName, restaurantKey, filePath, kindArg, outPath] = process.argv.slice(2);
  if (!restaurantName || !restaurantKey || !filePath || !kindArg || !outPath) {
    console.error(
      "Usage: tsx scripts/pilot-run-merchant.ts <restaurantName> <restaurantKey> <filePath> <pdf|image> <outJsonPath>",
    );
    process.exit(1);
  }
  if (kindArg !== "pdf" && kindArg !== "image") {
    console.error(`Invalid kind: ${kindArg} (must be pdf|image)`);
    process.exit(1);
  }

  const repoRoot = resolve(process.cwd());
  const result = await runRawSourceCertification({
    restaurantName,
    restaurantKey,
    rawFilePath: resolve(filePath),
    kind: kindArg,
    repoRoot,
  });

  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`=== PILOT BASELINE: ${restaurantName} ===`);
  console.log("sourceProductCount:", result.sourceProductCount);
  console.log("targetProducts:", result.stats.targetProducts);
  console.log("menuStatus:", result.stats.menuStatus);
  console.log("statusAccounting:", JSON.stringify(result.stats.statusAccounting));
  console.log("findingCounts:", JSON.stringify(result.stats.findingCounts));
  console.log("menuVariantCount (forbidden-name hits):", result.menuVariantCount);
  console.log("Full diagnostic written to:", outPath);
}

main().catch((err) => {
  console.error("PILOT RUN FAILED:", err);
  process.exit(1);
});
