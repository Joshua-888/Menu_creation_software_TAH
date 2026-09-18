import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)]),
  );
}

export function sha256Canonical(value: unknown): string {
  const encoded =
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : JSON.stringify(canonicalize(value));
  return createHash("sha256").update(encoded).digest("hex");
}
