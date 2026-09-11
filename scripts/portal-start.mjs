/**
 * Cross-platform portal start — honors Railway/Docker PORT and binds 0.0.0.0.
 */
import { spawn } from "node:child_process";

const port = process.env.PORT?.trim() || "3000";
const host = process.env.HOST?.trim() || "0.0.0.0";

const child = spawn(
  process.execPath,
  [
    "./node_modules/next/dist/bin/next",
    "start",
    "apps/portal",
    "-H",
    host,
    "-p",
    port,
  ],
  { stdio: "inherit", env: process.env },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
