/**
 * Print the latest Policy Application Report (owner audit).
 *   npm run m76:policy-report
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatPolicyApplicationMarkdown,
  readLatestPolicyApplication,
} from "../src/learning/policyApplicationReport.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = readLatestPolicyApplication(root);
if (!report) {
  const md = join(root, "runs", "decisions", "latest-policy-application.md");
  if (existsSync(md)) {
    console.log(readFileSync(md, "utf8"));
    process.exit(0);
  }
  console.error(
    "No policy application report yet. Run: npm run m76:pipeline",
  );
  process.exit(1);
}
console.log(formatPolicyApplicationMarkdown(report));
console.log(
  `\n(JSON: runs/decisions/latest-policy-application.json)`,
);
