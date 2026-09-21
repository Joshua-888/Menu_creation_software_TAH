import { stripMenuNumberFalsePrices } from "./priceNormalize.js";
import type { SourceCandidate } from "./types.js";

/**
 * Generic sub-section group-price inheritance (a PDF layout pattern, not a
 * merchant fact).
 *
 * Some menu PDFs print ONE price on the leading dish of a protein sub-section
 * and leave the sibling dishes in that same sub-section without their own price
 * token, relying on the reader to carry the group price down the column.
 *
 * Rule (sequential carry-forward, boundary-safe):
 * - Walk dishes in canonical reading order.
 * - A dish that carries its own single-column price is authoritative and sets
 *   the section's carried group price to that value.
 * - A dish with NO own price token inherits the carried group price, but only
 *   when it belongs to the same recognized sub-section, is in single-price mode
 *   (multi-column sections are never flattened) and a carried price exists
 *   (never fabricate a price from an unrelated dish).
 * - The carried price is cleared at every section boundary and whenever a
 *   multi-column/ambiguous priced dish appears, so inheritance never crosses a
 *   different sub-section or past a dish whose own price is ambiguous.
 * - Cross-page continuation: when a section heading is not repeated after a page
 *   break, the following numbered dishes read as UNKNOWN. They may still resume
 *   the immediately preceding recognized section, but only through a strict gate
 *   (different page than the preceding dish, pure-integer menu number that
 *   directly continues the previous number, single-price mode, and a carried
 *   group price still pending). This cannot fire on single-page sources.
 *
 * Inherited prices are tagged `priceOrigin: "DERIVED"` so downstream quality and
 * traceability never mistake them for a directly printed per-dish price.
 */

const NON_SECTIONS = new Set(["UNKNOWN", "UNCATEGORIZED", ""]);

function sectionKey(c: SourceCandidate): string {
  return (c.sectionHint ?? c.categoryHint ?? "UNCATEGORIZED").trim();
}

function isRecognizedSection(section: string): boolean {
  if (!section) return false;
  if (NON_SECTIONS.has(section.toUpperCase())) return false;
  if (/^UNLABELLED/i.test(section)) return false;
  return true;
}

function isSinglePriceMode(c: SourceCandidate): boolean {
  const mode = c.priceMode ?? "single";
  return mode === "single" || mode === "none";
}

/** Only pure-integer menu numbers participate in cross-page continuation. */
function pureIntMenuNumber(c: SourceCandidate): number | null {
  const raw = c.menuNumber?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function applySectionGroupPriceInheritance(
  candidates: readonly SourceCandidate[],
): SourceCandidate[] {
  let currentSection: string | null = null;
  let groupPrice: number | null = null;
  let continuationSection: string | null = null;
  let inContinuation = false;
  let lastNumber: number | null = null;
  let lastPage: number | null = null;

  return candidates.map((c) => {
    const section = sectionKey(c);
    const recognized = isRecognizedSection(section);
    const number = pureIntMenuNumber(c);
    const page = c.pageNumber;

    if (recognized) {
      if (section !== currentSection) {
        currentSection = section;
        groupPrice = null;
      }
      inContinuation = false;
      continuationSection = null;
    } else {
      const consecutive =
        number !== null && lastNumber !== null && number === lastNumber + 1;
      const canContinue =
        continuationSection !== null &&
        groupPrice !== null &&
        consecutive &&
        (inContinuation || (lastPage !== null && page !== lastPage));
      if (canContinue) {
        inContinuation = true;
        // keep currentSection / groupPrice / continuationSection
      } else {
        currentSection = section;
        groupPrice = null;
        inContinuation = false;
        continuationSection = null;
      }
    }

    const inheritableSection = recognized || inContinuation;
    const own = stripMenuNumberFalsePrices(c.rawPrices, c.menuNumber);

    if (own.length > 0) {
      // Own printed price is authoritative; refresh or clear the carried price.
      groupPrice = isSinglePriceMode(c) && own.length === 1 ? own[0]! : null;
      if (recognized) {
        continuationSection = section;
      } else if (inContinuation) {
        continuationSection = continuationSection ?? currentSection;
      }
      lastNumber = number;
      lastPage = page;
      return c;
    }

    const canInherit =
      !!c.menuNumber?.trim() &&
      inheritableSection &&
      isSinglePriceMode(c) &&
      groupPrice !== null;

    lastNumber = number;
    lastPage = page;

    if (!canInherit) return c;

    return {
      ...c,
      rawPrices: [groupPrice!],
      priceOrigin: "DERIVED",
    };
  });
}
