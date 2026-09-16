/**
 * Hash frozen golden oracles before certification. Does not modify goldens.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const outDir = join(root, "docs", "certification");
mkdirSync(outDir, { recursive: true });

function fileSha256(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

function commitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const goldens = [
  {
    id: "smash-final",
    goldenPath: "fixtures/golden/smash/expected-final-menu.json",
    goldenVersion: "golden-smash-v2-certified",
  },
  {
    id: "smash-canonical",
    goldenPath: "fixtures/golden/smash/expected-canonical-menu.json",
    goldenVersion: "smash-canonical-v1",
  },
  {
    id: "smash-source",
    goldenPath: "fixtures/golden/smash/expected-source-menu.json",
    goldenVersion: "smash-source-v1",
  },
  {
    id: "smash-raw-photo",
    goldenPath: "fixtures/golden/smash/raw-source.jpg",
    goldenVersion: "smash-raw-photo-v1",
  },
  {
    id: "veroni-v2",
    goldenPath: "fixtures/golden/veroni/VERONI_GOLDEN_V2.json",
    goldenVersion: "VERONI_GOLDEN_V2",
  },
  {
    id: "veroni-historical-72",
    goldenPath: "fixtures/veroni/golden-source.json",
    goldenVersion: "veroni-historical-72-oracle",
  },
  {
    id: "third-thai-expected",
    goldenPath: "fixtures/golden/third-merchant/expected-final-menu.json",
    goldenVersion: "golden-third-merchant-thai-v2",
  },
  {
    id: "third-thai-products",
    goldenPath: "fixtures/golden/third-merchant/THAI_HOUSE_GOLDEN_V1.json",
    goldenVersion: "THAI_HOUSE_GOLDEN_V1",
  },
  {
    id: "third-thai-raw",
    goldenPath: "fixtures/golden/third-merchant/raw-source.pdf",
    goldenVersion: "thai-raw-pdf-v2",
  },
];

const generatedAt = new Date().toISOString();
const entries = goldens.map((g) => {
  const abs = resolve(root, g.goldenPath);
  if (!existsSync(abs)) {
    return {
      ...g,
      exists: false,
      sha256: null as string | null,
      bytes: 0,
      lastReviewedAt: null as string | null,
    };
  }
  const st = readFileSync(abs);
  return {
    ...g,
    exists: true,
    sha256: fileSha256(abs),
    bytes: st.length,
    lastReviewedAt: generatedAt,
  };
});

const manifest = {
  purpose: "Freeze golden oracle hashes before certification — do not modify goldens during the run",
  commitSha: commitSha(),
  generatedAt,
  constitutionVersion: "MenuConstitutionV1",
  goldens: entries,
};

writeFileSync(
  join(outDir, "golden-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(JSON.stringify(manifest, null, 2));
