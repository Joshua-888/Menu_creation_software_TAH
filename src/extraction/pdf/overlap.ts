import type { ClassifiedPdfPage, OverlapLink } from "./types.js";
import { extractMenuNumberFromLine } from "./menuNumber.js";

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .split(/\s+/)
      .map(normalizeToken)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function extractMenuNumberTokens(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const a = extractMenuNumberFromLine(line.trim());
    if (a) out.push(a.menuNumber);
  }
  return [...new Set(out)];
}

export { parseMenuNumberFromAnchor as normalizeMenuNumberToken } from "./menuNumber.js";

function extractLikelyNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\n+/)) {
    const a = extractMenuNumberFromLine(line.trim());
    if (a?.rest) {
      const name = a.rest.replace(/\b\d+\s*,-?\b/g, "").trim();
      if (name.length >= 3) names.push(normalizeToken(name));
    }
  }
  return [...new Set(names.filter((n) => n.length >= 3))];
}

/**
 * Detect overlapping/duplicate pages. Does NOT discard pages —
 * returns links for later candidate reconciliation by menuNumber.
 */
export function detectOverlappingPages(
  pages: ClassifiedPdfPage[],
  opts?: { similarityThreshold?: number; minSharedNumbers?: number },
): {
  links: OverlapLink[];
  pages: ClassifiedPdfPage[];
} {
  const threshold = opts?.similarityThreshold ?? 0.35;
  const minShared = opts?.minSharedNumbers ?? 3;
  const menuPages = pages.filter((p) => p.classification === "MENU_CONTENT");
  const links: OverlapLink[] = [];
  const overlapping = new Set<number>();

  for (let i = 0; i < menuPages.length; i++) {
    for (let j = i + 1; j < menuPages.length; j++) {
      const a = menuPages[i]!;
      const b = menuPages[j]!;
      const sim = jaccard(tokenize(a.rawText), tokenize(b.rawText));
      const numsA = extractMenuNumberTokens(a.rawText);
      const numsB = extractMenuNumberTokens(b.rawText);
      const sharedMenuNumbers = numsA.filter((n) => numsB.includes(n));
      const namesA = extractLikelyNames(a.rawText);
      const namesB = extractLikelyNames(b.rawText);
      const sharedProductNames = namesA.filter((n) => namesB.includes(n));

      const overlappingEvidence =
        (sim >= threshold && sharedMenuNumbers.length >= minShared) ||
        (sharedMenuNumbers.length >= Math.max(minShared, 5) &&
          sharedProductNames.length >= 1) ||
        (sharedProductNames.length >= 3 && sharedMenuNumbers.length >= 2);

      if (!overlappingEvidence) continue;

      links.push({
        pageA: a.pageNumber,
        pageB: b.pageNumber,
        textSimilarity: Number(sim.toFixed(3)),
        sharedMenuNumbers,
        sharedProductNames,
        reason: `similarity=${sim.toFixed(3)}, sharedNumbers=${sharedMenuNumbers.length}, sharedNames=${sharedProductNames.length}`,
      });
      overlapping.add(Math.max(a.pageNumber, b.pageNumber));
    }
  }

  const updated = pages.map((p) => {
    if (!overlapping.has(p.pageNumber)) return p;
    if (p.classification !== "MENU_CONTENT") return p;
    return {
      ...p,
      classification: "DUPLICATE_OR_OVERLAPPING" as const,
      classificationReason: `overlapping menu content with earlier page(s); ${
        links
          .filter(
            (l) => l.pageA === p.pageNumber || l.pageB === p.pageNumber,
          )
          .map((l) => l.reason)
          .join("; ")
      }`,
    };
  });

  return { links, pages: updated };
}
