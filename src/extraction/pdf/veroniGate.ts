import { readFileSync } from "node:fs";
import type { SourceMenu } from "../../domain/schema/source.js";

export type VeroniGoldenFixture = {
  fixtureId: string;
  uniqueProductCount: number;
  menuNumbers: string[];
  sections: Array<{ name: string; menuNumbers: string[] }>;
  rules: {
    page4OverlapsPage3: boolean;
    menuIsPriceColumnNotCategory: boolean;
    lilleStorOnlyProduct48: boolean;
    alphanumericPreserved: string[];
    ocrGarbageNotMenuNumbers: string[];
  };
  expectedNames: Record<string, string>;
};

export type MenuNumberReconciliationRow = {
  menuNumber: string;
  name: string;
  sourcePage: number | null;
  sourceSection: string;
  extractionStatus: "FOUND" | "MISSING" | "EXTRA";
};

export function loadVeroniGoldenFixture(
  path = "fixtures/veroni/golden-source.json",
): VeroniGoldenFixture {
  return JSON.parse(readFileSync(path, "utf8")) as VeroniGoldenFixture;
}

export function listSourceProducts(menu: SourceMenu): Array<{
  menuNumber: string;
  name: string;
  section: string;
  page: number | null;
  sourceId: string;
  variants: string[];
  priceModeHints: string[];
}> {
  const out: Array<{
    menuNumber: string;
    name: string;
    section: string;
    page: number | null;
    sourceId: string;
    variants: string[];
    priceModeHints: string[];
  }> = [];
  for (const cat of menu.categories) {
    for (const p of cat.products) {
      out.push({
        menuNumber: p.sourceMenuNumber ?? "",
        name: p.name,
        section: cat.name,
        page: p.evidence?.pageNumber ?? null,
        sourceId: p.sourceId,
        variants: p.variants.map((v) => v.name),
        priceModeHints: (p.sourcePriceOptions ?? []).map((o) => o.label),
      });
    }
  }
  return out;
}

export function reconcileAgainstGolden(
  menu: SourceMenu,
  golden: VeroniGoldenFixture,
): {
  uniqueProductCount: number;
  expectedCount: number;
  pass: boolean;
  missing: string[];
  extra: string[];
  rows: MenuNumberReconciliationRow[];
  sectionIssues: string[];
  structuralIssues: string[];
} {
  const products = listSourceProducts(menu);
  const found = new Map(products.map((p) => [p.menuNumber, p]));
  const missing = golden.menuNumbers.filter((n) => !found.has(n));
  const extra = [...found.keys()].filter(
    (n) => n && !golden.menuNumbers.includes(n),
  );

  const rows: MenuNumberReconciliationRow[] = golden.menuNumbers.map((n) => {
    const p = found.get(n);
    if (!p) {
      return {
        menuNumber: n,
        name: golden.expectedNames[n] ?? "",
        sourcePage: null,
        sourceSection: "",
        extractionStatus: "MISSING",
      };
    }
    return {
      menuNumber: n,
      name: p.name,
      sourcePage: p.page,
      sourceSection: p.section,
      extractionStatus: "FOUND",
    };
  });
  for (const n of extra) {
    const p = found.get(n)!;
    rows.push({
      menuNumber: n,
      name: p.name,
      sourcePage: p.page,
      sourceSection: p.section,
      extractionStatus: "EXTRA",
    });
  }

  const structuralIssues: string[] = [];
  if (menu.categories.some((c) => /^menu$/i.test(c.name.trim()))) {
    structuralIssues.push("MENU must not be a source category");
  }

  const lilleStor = products.filter((p) =>
    p.variants.includes("Lille") && p.variants.includes("Stor"),
  );
  if (lilleStor.length !== 1 || lilleStor[0]?.menuNumber !== "48") {
    structuralIssues.push(
      `Lille/Stor must be scoped to product 48 only (found ${lilleStor.map((p) => p.menuNumber).join(",") || "none"})`,
    );
  }

  for (const a of golden.rules.alphanumericPreserved) {
    if (!found.has(a)) structuralIssues.push(`missing alphanumeric ${a}`);
  }
  for (const g of golden.rules.ocrGarbageNotMenuNumbers) {
    if (found.has(g)) structuralIssues.push(`OCR garbage promoted: ${g}`);
  }

  const sectionIssues: string[] = [];
  for (const sec of golden.sections) {
    const soft = sec.name.replace(/\s+/g, " ").toLowerCase();
    for (const num of sec.menuNumbers) {
      const p = found.get(num);
      if (!p) continue;
      const got = p.section.toLowerCase();
      // Allow INDISK / Forretter|Hovedretter under INDISK expectation
      if (soft.startsWith("indisk")) {
        if (!got.includes("indisk")) {
          sectionIssues.push(`${num} expected INDISK* got ${p.section}`);
        }
        continue;
      }
      if (soft.includes("unlabelled")) {
        if (!got.includes("unlabelled") && !got.includes("36")) {
          // soft: accept UNKNOWN-like
          if (!/unlabelled|unknown|36/.test(got)) {
            sectionIssues.push(`${num} expected unlabelled section got ${p.section}`);
          }
        }
        continue;
      }
      if (!got.includes(soft.slice(0, 8)) && norm(got) !== norm(soft)) {
        // pizza products 19-21 may still be under PIZZA before indbagt on page3
        if (sec.name === "PIZZA" && Number(num) <= 21 && got.includes("pizza")) {
          continue;
        }
        sectionIssues.push(`${num} expected ~${sec.name} got ${p.section}`);
      }
    }
  }

  const uniqueProductCount = products.length;
  const pass =
    uniqueProductCount === golden.uniqueProductCount &&
    missing.length === 0 &&
    extra.length === 0 &&
    structuralIssues.length === 0;

  return {
    uniqueProductCount,
    expectedCount: golden.uniqueProductCount,
    pass,
    missing,
    extra,
    rows,
    sectionIssues,
    structuralIssues,
  };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
