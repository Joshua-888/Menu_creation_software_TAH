#!/usr/bin/env node
/**
 * FAST CHECK — remind / soft-gate after agent stop.
 * Does not run Playwright or full integration suites.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

let input = "";
try {
  input = await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
} catch {
  input = "";
}

void input;

const packageJson = join(process.cwd(), "package.json");
if (!existsSync(packageJson)) {
  console.log(
    JSON.stringify({
      continue: true,
      message: "FAST CHECK skipped: no package.json in cwd",
    }),
  );
  process.exit(0);
}

const result = spawnSync("npm", ["run", "check"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: true,
});

if (result.status !== 0) {
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  console.log(
    JSON.stringify({
      continue: true,
      message: `FAST CHECK failed (typecheck/domain). Fix before treating M1 work as done.\n${combined.slice(0, 2000)}`,
    }),
  );
  process.exit(0);
}

console.log(
  JSON.stringify({
    continue: true,
    message: "FAST CHECK passed (typecheck + domain tests).",
  }),
);
