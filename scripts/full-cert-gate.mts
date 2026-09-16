/**
 * Full uninterrupted certification gate — records suite results to a log file.
 * No customer mutations.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const startedAt = new Date();
const sha = (() => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();
const logDir = join(root, "runs", "certification");
mkdirSync(logDir, { recursive: true });
const logPath = join(
  logDir,
  `full-gate-${startedAt.toISOString().replace(/[:.]/g, "-")}.log`,
);

function log(line: string) {
  appendFileSync(logPath, line + "\n", "utf8");
  console.log(line);
}

writeFileSync(
  logPath,
  [
    `FULL_GATE_START=${startedAt.toISOString()}`,
    `COMMIT_SHA=${sha}`,
    `DIRTY_TREE=yes`,
    "",
  ].join("\n"),
  "utf8",
);

const steps: Array<{ name: string; cmd: string; args: string[] }> = [
  { name: "TYPECHECK", cmd: "npm", args: ["run", "typecheck"] },
  { name: "DOMAIN", cmd: "npm", args: ["run", "test:domain"] },
  { name: "UNIT", cmd: "npm", args: ["run", "test:unit"] },
  { name: "CONTRACT", cmd: "npm", args: ["run", "test:contract"] },
  { name: "CERTIFICATION", cmd: "npm", args: ["run", "test:certification"] },
  { name: "EXTRACTION", cmd: "npm", args: ["run", "test:extraction"] },
  { name: "PORTAL", cmd: "npm", args: ["run", "test:portal"] },
  { name: "PORTAL_BUILD", cmd: "npm", args: ["run", "portal:build"] },
];

const results: Array<{ name: string; pass: boolean; code: number }> = [];

for (const step of steps) {
  log(`=== ${step.name} ===`);
  const r = spawnSync(step.cmd, step.args, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.stdout) appendFileSync(logPath, r.stdout, "utf8");
  if (r.stderr) appendFileSync(logPath, r.stderr, "utf8");
  const code = r.status ?? 1;
  const pass = code === 0;
  results.push({ name: step.name, pass, code });
  log(`${step.name}_${pass ? "PASS" : "FAIL"} exit=${code}`);
  if (!pass) {
    const endedAt = new Date();
    log(`FULL_GATE_END=${endedAt.toISOString()}`);
    log(`FULL_GATE_PASS=NO`);
    log(`FAILED_STEP=${step.name}`);
    log(
      `DURATION_SEC=${Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)}`,
    );
    console.error(JSON.stringify({ logPath, results }, null, 2));
    process.exit(code);
  }
}

const endedAt = new Date();
log(`FULL_GATE_END=${endedAt.toISOString()}`);
log(`FULL_GATE_PASS=YES`);
log(
  `DURATION_SEC=${Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)}`,
);
console.log(JSON.stringify({ logPath, results, sha }, null, 2));
