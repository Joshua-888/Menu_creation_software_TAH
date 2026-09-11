/**
 * Layout-first product candidate detection for scanned PDF menus.
 *
 * Principles:
 * - Spatial lines + column roles beat flattened OCR
 * - "Menu" alone is a PRICE COLUMN, never a category
 * - Variant headers (Alm./Familie, Lille/Stor) have explicit scope
 * - Period-terminated anchors are menu numbers; comma tokens are prices
 */

import type { SourceEvidence } from "../../domain/evidence.js";
import { extractAloneCommaMenuNumber, extractMenuNumberFromLine } from "./menuNumber.js";
import {
  fillAlmFamilieFromSection,
  pickAlmFamiliePair,
  pickBaseMenuPair,
  repairOcrPriceText,
  stripMenuNumberFalsePrices,
} from "./priceNormalize.js";
import { extractCommaPrices, parseKronerToken } from "./prices.js";
import {
  applyRenderedPageFallback,
  looksLikeOcrGarbageName,
  repairScandinavianOcrName,
} from "./renderedFallback.js";
import type {
  ClassifiedPdfPage,
  PdfTextItem,
  SourceCandidate,
} from "./types.js";
import { PDF_EXTRACTOR_VERSION } from "./types.js";

export type PriceColumnMode =
  | "alm_familie"
  | "lille_stor_next"
  | "base_menu"
  | "single"
  | "none";

type SectionState = {
  section: string;
  priceMode: PriceColumnMode;
  /** One-shot Lille/Stor for the next product only. */
  pendingLocalVariants: string[] | null;
  /** Prices seen after local variant headers, before the product row. */
  pendingLocalPrices: number[];
};

const SECTION_HEADINGS: Array<{ re: RegExp; name: string }> = [
  { re: /^indbagt.*ufo.*calzone$/i, name: "Indbagt, ufo og calzone" },
  { re: /^salatpizza$/i, name: "Salatpizza" },
  { re: /^vegetarpizza$/i, name: "Vegetarpizza" },
  // Exact heading only — do NOT match product names like "Pasta Alfredo…"
  { re: /^pasta$/i, name: "Pasta" },
  { re: /^grill$/i, name: "GRILL" },
  { re: /^sandwich$/i, name: "Sandwich - hjemmelavet inkl. pommes frites" },
  { re: /^sandwich\b.*hjemmelavet/i, name: "Sandwich - hjemmelavet inkl. pommes frites" },
  { re: /^nachos$/i, name: "Nachos" },
  { re: /^indisk$/i, name: "INDISK" },
  { re: /^forretter$/i, name: "INDISK / Forretter" },
  { re: /^hovedretter$/i, name: "INDISK / Hovedretter" },
  { re: /^drikkevarer$/i, name: "DRIKKEVARER" },
  { re: /^pizza$/i, name: "PIZZA" },
];

function isMenuPriceColumnHeader(line: string): boolean {
  const t = line.trim();
  // Standalone Menu / Menu with prices nearby — NOT a category
  if (/^menu$/i.test(t)) return true;
  if (/^menu\s+\d/i.test(t)) return true;
  return false;
}

function detectSectionHeading(line: string): string | null {
  const t = line.trim();
  if (isMenuPriceColumnHeader(t)) return null;
  if (/^alm\.?\s+familie$/i.test(t) || /^familie\s+alm/i.test(t)) return null;
  if (/^lille$/i.test(t) || /^stor$/i.test(t)) return null;
  if (/^ekstra:?$/i.test(t)) return null;
  for (const h of SECTION_HEADINGS) {
    if (h.re.test(t)) return h.name;
  }
  return null;
}

function cleanName(raw: string): string {
  return repairScandinavianOcrName(
    raw
      .replace(/\b\d{1,4}\s*,-?/g, " ")
      .replace(/\b\d{1,4}\s*$/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[-–|]+\s*/, "")
      .trim(),
  );
}

function isVariantOrColumnHeader(line: string): boolean {
  const t = line.trim();
  return (
    isMenuPriceColumnHeader(t) ||
    /^alm\.?$/i.test(t) ||
    /^familie$/i.test(t) ||
    /^lille$/i.test(t) ||
    /^stor$/i.test(t) ||
    /^ekstra:?$/i.test(t) ||
    (/lille/i.test(t) && /stor/i.test(t) && t.length < 40)
  );
}

function looksLikeIngredient(text: string): boolean {
  const t = text.toLowerCase().trim();
  // Product titles often include protein words ("Pasta Alfredo med Kylling").
  // Do not classify short "X med Y" titles or dish-name openers as ingredients.
  if (
    /^(pasta|spaghetti|pizza|calzone|ufo|d[uü]r[uü]m|kebabmix|pølsemix|kebabmenu|nachos|samosa|pommes|grill|nuggets|indian\s+roles|butter\s+chicken|fried\s+(rice|noodles)|kottu)/i.test(
      text.trim(),
    )
  ) {
    return false;
  }
  // "½ Grillkylling..." is a product title; "½ skinke, ½ kebab" is ingredients
  if (/^½\s+[A-Za-zÆØÅæøå]/i.test(text.trim()) && !/,/.test(text)) {
    return false;
  }
  // Short accompaniment lines: "med grøntsager", "med oksefyld og kartofler"
  if (/^med\s+/i.test(t) && t.split(/\s+/).length <= 8) {
    if (
      /gr[øo]ntsager|oksefyld|kartofler|salat|dressing|kylling|k[øo]d|rejer|spinat|champignon/.test(
        t,
      )
    ) {
      return true;
    }
  }
  if (/\bmed\b/i.test(t) && !/,/.test(t) && t.split(/\s+/).length <= 8) {
    return false;
  }
  // Descriptive sauce/accompaniment lines (Pasta #33 style)
  if (
    /^klassisk\b/i.test(t) ||
    /\bk[øo]dsovs\b|\bfl[øo]desovs\b|\bdyppelse\b|\bvalgfri\b/.test(t)
  ) {
    return true;
  }
  if (
    /gr[øo]ntsager|oksefyld|kartofler|tigerrejer|parmesan|penne|spinat|brodmix/.test(
      t,
    ) &&
    t.length < 90 &&
    !/^\d/.test(t)
  ) {
    return true;
  }
  // Comma-separated accompaniment lists (e.g. "Pitabrød, pommes frites og sodavand")
  if (/,/.test(t) && /[a-zæøå]{3,}/i.test(t) && !/^\d/.test(t)) {
    return true;
  }
  if (
    /tomat|ost|salat|dressing|champignon|kebab|kylling|skinke|bacon|ris\/|naan|pitabr[oø]d|sodavand|pommes\s+frites/.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function slashChoiceHints(text: string): string[] {
  const hints: string[] = [];
  if (/valgfrit\s+k[oø]d/i.test(text)) {
    hints.push("PRODUCT_CHOICE: valgfrit kød");
  }
  if (/skinke\s*\/\s*kebab/i.test(text)) {
    hints.push("PRODUCT_CHOICE: skinke/kebab");
  }
  if (/kylling\s*(eller|\/)\s*okse/i.test(text)) {
    hints.push("PRODUCT_CHOICE: kylling/okse");
  }
  if (/kylling\s*\/\s*okse\s*\/\s*vegetar/i.test(text)) {
    hints.push("PRODUCT_CHOICE: kylling/okse/vegetar");
  }
  if (/kylling\s*\/\s*okse\s*\/\s*gr[øo]ntsager\s*\/\s*rejer/i.test(text)) {
    hints.push("PRODUCT_CHOICE: kylling/okse/grøntsager/rejer");
  }
  if (/vælg mellem/i.test(text)) {
    hints.push("PRODUCT_CHOICE: Vælg mellem");
  }
  return hints;
}

function updatePriceModeFromLine(
  line: string,
  state: SectionState,
): SectionState {
  const t = line.trim();
  if (isMenuPriceColumnHeader(t)) {
    return {
      ...state,
      priceMode: "base_menu",
      pendingLocalVariants: null,
      pendingLocalPrices: [],
    };
  }
  if (/\balm\.?\b/i.test(t) && /\bfamilie\b/i.test(t)) {
    return {
      ...state,
      priceMode: "alm_familie",
      pendingLocalVariants: null,
      pendingLocalPrices: [],
    };
  }
  if (/^alm\.?$/i.test(t) || /^familie$/i.test(t)) {
    if (
      state.section.toUpperCase().includes("PIZZA") ||
      state.section === "PIZZA"
    ) {
      return { ...state, priceMode: "alm_familie" };
    }
  }
  if (/^lille$/i.test(t) || /^stor$/i.test(t)) {
    const pending = new Set(state.pendingLocalVariants ?? []);
    if (/lille/i.test(t)) pending.add("Lille");
    if (/stor/i.test(t)) pending.add("Stor");
    if (pending.size >= 1) {
      return {
        ...state,
        priceMode: "lille_stor_next",
        pendingLocalVariants: [...pending],
      };
    }
  }
  if (/lille/i.test(t) && /stor/i.test(t) && t.length < 40) {
    return {
      ...state,
      priceMode: "lille_stor_next",
      pendingLocalVariants: ["Lille", "Stor"],
    };
  }
  // Accumulate prices between Lille/Stor headers and the product row
  if (state.pendingLocalVariants && state.pendingLocalVariants.length > 0) {
    const prices = extractCommaPrices(t);
    if (prices.length && /^\d+\s*,/.test(t)) {
      return {
        ...state,
        pendingLocalPrices: [...state.pendingLocalPrices, ...prices],
      };
    }
  }
  return state;
}

function variantNamesForProduct(
  state: SectionState,
  productName: string,
): { names: string[]; consumeLocal: boolean; mode: PriceColumnMode } {
  // Attach Lille/Stor when both seen — next product only (typically Pommes)
  if (
    state.pendingLocalVariants &&
    state.pendingLocalVariants.length >= 2 &&
    (state.priceMode === "lille_stor_next" ||
      state.pendingLocalVariants.includes("Lille"))
  ) {
    return {
      names: ["Lille", "Stor"],
      consumeLocal: true,
      mode: "lille_stor_next",
    };
  }
  if (state.priceMode === "alm_familie") {
    return { names: ["Alm.", "Familie"], consumeLocal: false, mode: "alm_familie" };
  }
  if (state.priceMode === "base_menu") {
    return { names: ["BASE", "Menu"], consumeLocal: false, mode: "base_menu" };
  }
  return { names: ["Alm."], consumeLocal: false, mode: "single" };
}

function parsePriceItem(str: string): number | null {
  const repaired = repairOcrPriceText(str.trim());
  if (!/\d/.test(repaired)) return null;
  // Prefer comma-price tokens
  const m = repaired.match(/(\d{1,4})\s*,-?/);
  if (m) return parseKronerToken(`${m[1]},`);
  const bare = repaired.match(/^(\d{2,3})$/);
  if (bare) return parseKronerToken(bare[1]!);
  return null;
}

/**
 * When reading-order OCR attaches Alm/Familie prices to the wrong row
 * (prices sit slightly above the next menu number), recover from spatial items.
 */
function attachSpatialAlmFamiliePrices(
  candidates: SourceCandidate[],
  pages: ClassifiedPdfPage[],
): SourceCandidate[] {
  const pageItems = new Map<number, PdfTextItem[]>();
  for (const p of pages) pageItems.set(p.pageNumber, p.items);

  return candidates.map((c) => {
    if (c.priceMode !== "alm_familie") return c;
    if (pickAlmFamiliePair(c.rawPrices)) return c;
    const items = pageItems.get(c.pageNumber);
    if (!items?.length || !c.menuNumber) return c;

    const anchorRe = new RegExp(
      `^${c.menuNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?,?$`,
      "i",
    );
    const anchors = items.filter((it) => anchorRe.test(it.str.trim()));
    if (!anchors.length) return c;
    const ay = anchors[0]!.y;

    const nearbyPrices: Array<{ x: number; y: number; v: number }> = [];
    for (const it of items) {
      if (Math.abs(it.y - ay) > 35) continue;
      if (it.x < 240) continue; // price columns are right-side
      const v = parsePriceItem(it.str);
      if (v !== null && v >= 50 && v <= 400) {
        nearbyPrices.push({ x: it.x, y: it.y, v });
      }
    }
    nearbyPrices.sort((a, b) => a.x - b.x || a.y - b.y);
    const vals = nearbyPrices.map((p) => p.v);
    const pair = pickAlmFamiliePair(
      stripMenuNumberFalsePrices(vals, c.menuNumber),
    );
    if (!pair) return c;
    return {
      ...c,
      rawPrices: pair,
      confidence: Math.min(Math.max(c.confidence, 0.75), 0.9),
    };
  });
}

/**
 * Layout-aware candidate detection. Replaces flat OCR token promotion.
 */
export function detectSourceCandidatesLayout(
  pages: ClassifiedPdfPage[],
  sourceFile: string,
): SourceCandidate[] {
  const candidates: SourceCandidate[] = [];
  let seq = 0;

  for (const page of pages) {
    if (
      page.classification !== "MENU_CONTENT" &&
      page.classification !== "DUPLICATE_OR_OVERLAPPING"
    ) {
      continue;
    }

    let state: SectionState = {
      section: page.pageNumber <= 4 ? "PIZZA" : "UNKNOWN",
      priceMode: page.pageNumber <= 4 ? "alm_familie" : "none",
      pendingLocalVariants: null,
      pendingLocalPrices: [],
    };
    /** Consecutive single-price rows while Menu-column mode is active → column ended. */
    let consecutiveBaseMenuSingles = 0;

    const lines = page.lines.map((l) => l.text);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;

      const heading = detectSectionHeading(line);
      if (heading) {
        state = {
          section: heading,
          priceMode:
            heading === "PIZZA" ||
            heading.startsWith("Salat") ||
            heading.startsWith("Vegetar")
              ? "alm_familie"
              : heading === "GRILL"
                ? "base_menu"
                : "single",
          pendingLocalVariants: null,
          pendingLocalPrices: [],
        };
        consecutiveBaseMenuSingles = 0;
        // Same line may also carry Alm./Familie
        state = updatePriceModeFromLine(line, state);
        i += 1;
        continue;
      }

      state = updatePriceModeFromLine(line, state);

      // Skip pure column headers / non-product lines
      if (
        isMenuPriceColumnHeader(line) ||
        /^alm\.?$/i.test(line.trim()) ||
        /^familie$/i.test(line.trim()) ||
        /^lille$/i.test(line.trim()) ||
        /^stor$/i.test(line.trim()) ||
        /^ekstra:?$/i.test(line.trim())
      ) {
        i += 1;
        continue;
      }

      const alone = extractAloneCommaMenuNumber(
        line,
        lines[i + 1],
        i > 0 ? lines[i - 1] : undefined,
      );
      const anchor = extractMenuNumberFromLine(line) ?? alone;
      if (!anchor) {
        i += 1;
        continue;
      }

      let namePart = cleanName(anchor.rest);
      if (
        !namePart &&
        alone &&
        "nameFromPrev" in alone &&
        alone.nameFromPrev
      ) {
        namePart = cleanName(alone.nameFromPrev);
      }
      // Names often sit on the line immediately above the menu number
      if (!namePart && i > 0) {
        const prev = lines[i - 1]!;
        if (
          !extractMenuNumberFromLine(prev) &&
          !detectSectionHeading(prev) &&
          !looksLikeIngredient(prev) &&
          !/^\d+\s*,/.test(prev.trim()) &&
          !/^(alm\.?|familie|lille|stor|menu)$/i.test(prev.trim()) &&
          prev.trim().length > 1 &&
          prev.trim().length < 50
        ) {
          namePart = cleanName(prev);
        }
      }
      // Continuation labels like "- flaske" sit above the next menu number
      if (
        namePart &&
        i > 0 &&
        /^[-–]\s*[A-Za-zÆØÅæøå]/.test(lines[i - 1]!.trim()) &&
        !looksLikeIngredient(lines[i - 1]!) &&
        !namePart.toLowerCase().includes(
          lines[i - 1]!.replace(/^[-–]\s*/, "").trim().toLowerCase(),
        )
      ) {
        namePart = cleanName(`${namePart} ${lines[i - 1]}`);
      }
      const bundle: string[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j]!;
        if (extractMenuNumberFromLine(next)) break;
        if (
          extractAloneCommaMenuNumber(
            next,
            lines[j + 1],
            lines[j - 1],
          )
        ) {
          break;
        }
        if (detectSectionHeading(next)) break;
        if (isVariantOrColumnHeader(next)) break;
        // Title OR price line immediately before the next menu number belongs to that product
        const after = lines[j + 1];
        if (
          after &&
          extractMenuNumberFromLine(after) &&
          !looksLikeIngredient(next) &&
          (/^\d+\s*,/.test(next.trim()) ||
            (/[A-Za-zÆØÅæøå]{3,}/.test(next) && !/^\d+\s*,/.test(next.trim())))
        ) {
          // Price pair sitting above the next row → pending for next product
          if (
            state.priceMode === "base_menu" &&
            /^\d+\s*,/.test(next.trim())
          ) {
            const pending = stripMenuNumberFalsePrices(
              extractCommaPrices(next),
              "",
            );
            if (pending.length) {
              state = { ...state, pendingLocalPrices: pending };
            }
          }
          break;
        }
        // Also stop before a lone price line that is followed by another price then a menu #
        // (BASE/Menu printed above the next product as two lines)
        if (
          state.priceMode === "base_menu" &&
          /^\d+\s*,/.test(next.trim()) &&
          after &&
          /^\d+\s*,/.test(after.trim())
        ) {
          const after2 = lines[j + 2];
          if (after2 && extractMenuNumberFromLine(after2)) {
            const pending = stripMenuNumberFalsePrices(
              extractCommaPrices(`${next} ${after}`),
              "",
            );
            if (pending.length) {
              state = { ...state, pendingLocalPrices: pending };
            }
            break;
          }
        }
        bundle.push(next);
        if (
          !namePart &&
          !looksLikeIngredient(next) &&
          !/^\d+\s*,/.test(next.trim()) &&
          !/^(alm\.?|familie|lille|stor)$/i.test(next.trim())
        ) {
          namePart = cleanName(next);
        }
        // Split titles: "|34. Pasta Alfredo" then "med Kylling" on the next line
        if (
          namePart &&
          /^med\s+[A-Za-zÆØÅæøå½]/i.test(next.trim()) &&
          !/,/.test(next) &&
          next.trim().length < 40
        ) {
          namePart = cleanName(`${namePart} ${next}`);
        }
        // Fix Calzone/Ufo split names — keep only the person/label token after dash
        if (/^(calzone|ufo)$/i.test(namePart ?? "")) {
          const m = next.match(/[-–]\s*([A-Za-zÆØÅæøå]+)/);
          if (m) namePart = `${namePart} - ${m[1]}`;
        }
        const calzoneGlued = (namePart ?? "").match(
          /^(calzone|ufo)\s*[-–]\s*([A-Za-zÆØÅæøå]+)\b(.*)$/i,
        );
        if (calzoneGlued && calzoneGlued[3]?.trim()) {
          // e.g. "Calzone -Karan champignon" → name Calzone - Karan; rest is ingredients
          namePart = `${calzoneGlued[1]} - ${calzoneGlued[2]}`;
        }
        // "Bacon" + "burger" on next line
        if (/^bacon$/i.test(namePart ?? "") && /^burger$/i.test(next.trim())) {
          namePart = "Baconburger";
        }
        // "Fried rice med" + "grøntsager og æg"
        if (
          /^fried rice med$/i.test(namePart ?? "") &&
          /gr[øo]ntsager/i.test(next) &&
          /[æe]g/i.test(next)
        ) {
          namePart = "Fried rice med grøntsager og æg";
        }
        j += 1;
        if (bundle.length > 10) break;
      }

      // Strip ingredient words glued onto Calzone/Ufo titles on a single line
      {
        const glued = (namePart ?? "").match(
          /^(calzone|ufo)\s*[-–]\s*([A-Za-zÆØÅæøå]+)\b(.*)$/i,
        );
        if (glued && glued[3]?.trim()) {
          namePart = `${glued[1]} - ${glued[2]}`;
        }
      }
      // Prefer full dish titles present in the bundle over short garbage fragments
      {
        const bundleLines = bundle.map((b) => b.trim());
        const fried = bundleLines.find((l) =>
          /^fried\s+(rice|noodles)\b/i.test(l.replace(/\b\d+\s*,-?/g, " ").trim()),
        );
        if (fried) {
          let title = cleanName(fried);
          const veg = bundleLines.find(
            (l) => /gr[øoØo]ntsager/i.test(l) && /æg|eg/i.test(l),
          );
          if (/^fried rice med$/i.test(title) && veg) {
            title = "Fried rice med grøntsager og æg";
          }
          if (
            !namePart ||
            looksLikeOcrGarbageName(namePart) ||
            (namePart.split(/\s+/).length <= 2 && title.split(/\s+/).length >= 2)
          ) {
            namePart = title;
          }
        }
      }

      // Salatpizza often lacks per-row names — leave empty → review, still count as product
      const variantInfo = variantNamesForProduct(state, namePart || "");
      const rawBundle = bundle.join("\n");
      let prices = stripMenuNumberFalsePrices(
        extractCommaPrices(rawBundle),
        anchor.menuNumber,
      );
      if (
        variantInfo.mode === "lille_stor_next" &&
        state.pendingLocalPrices.length >= 2
      ) {
        // Layout: prices appear above the product row; Lille=lower, Stor=higher
        prices = [...state.pendingLocalPrices].sort((a, b) => a - b);
      }
      // Alm./Familie: consume pending pair left by previous row (prices printed before next #)
      if (
        variantInfo.mode === "alm_familie" &&
        prices.length === 0 &&
        state.pendingLocalPrices.length >= 2
      ) {
        prices = [...state.pendingLocalPrices];
        state = { ...state, pendingLocalPrices: [] };
      }
      // BASE+Menu: prices often sit above the row; consume pending pair
      if (
        variantInfo.mode === "base_menu" &&
        prices.length < 2 &&
        state.pendingLocalPrices.length >= 1
      ) {
        const merged = stripMenuNumberFalsePrices(
          [...state.pendingLocalPrices, ...prices],
          anchor.menuNumber,
        );
        const pair = pickBaseMenuPair(merged);
        if (pair) {
          prices = pair;
          state = { ...state, pendingLocalPrices: [] };
        } else if (prices.length === 0 && state.pendingLocalPrices.length) {
          prices = state.pendingLocalPrices.slice(0, 2);
          state = { ...state, pendingLocalPrices: [] };
        }
      }
      // Look behind: BASE+Menu pair printed on lines immediately above this product
      if (variantInfo.mode === "base_menu" && prices.length < 2 && i > 0) {
        const above: number[] = [];
        for (let k = i - 1; k >= Math.max(0, i - 3); k -= 1) {
          const prev = lines[k]!;
          if (extractMenuNumberFromLine(prev)) break;
          if (detectSectionHeading(prev)) break;
          if (/^\d+\s*,/.test(prev.trim()) || /\d+\s*,/.test(prev)) {
            above.push(
              ...stripMenuNumberFalsePrices(extractCommaPrices(prev), anchor.menuNumber),
            );
          } else if (/[A-Za-zÆØÅæøå]{3,}/.test(prev) && !/^\d+\s*,/.test(prev.trim())) {
            // name line above may carry the Menu price (e.g. "Dürüm rulle 125,")
            above.push(
              ...stripMenuNumberFalsePrices(extractCommaPrices(prev), anchor.menuNumber),
            );
            break;
          } else {
            break;
          }
        }
        const pair = pickBaseMenuPair(
          stripMenuNumberFalsePrices([...above.reverse(), ...prices], anchor.menuNumber),
        );
        if (pair) prices = pair;
      }
      // If this row already has a pair and extra trailing prices, stash for next product
      if (variantInfo.mode === "alm_familie" && prices.length >= 4) {
        const first = pickAlmFamiliePair(prices);
        const rest = pickAlmFamiliePair(prices.slice(2));
        if (first && rest) {
          prices = first;
          state = { ...state, pendingLocalPrices: rest };
        } else if (first) {
          prices = first;
        }
      } else if (variantInfo.mode === "alm_familie") {
        const pair = pickAlmFamiliePair(prices);
        if (pair) prices = pair;
      }
      // Do NOT fall back to bare integers — that promotes menu numbers to prices.

      if (variantInfo.consumeLocal) {
        state = {
          ...state,
          pendingLocalVariants: null,
          pendingLocalPrices: [],
          priceMode: "single",
        };
      }

      const ingredientLines = bundle.filter(
        (b, idx) => idx > 0 && looksLikeIngredient(b),
      );
      const ingredientText = ingredientLines.join(", ").replace(/\s+/g, " ").trim();

      const additions: SourceCandidate["additions"] = [];
      if (/ekstra/i.test(rawBundle) && /grøntsager|k[oø]d/i.test(rawBundle)) {
        const veg = rawBundle.match(/grøntsager:\s*(\d+)\s*,/i);
        const meat = rawBundle.match(/k[oø]d:\s*(\d+)\s*,?/i);
        if (veg) additions.push({ name: "Ekstra grøntsager", priceKroner: Number(veg[1]) });
        if (meat) additions.push({ name: "Ekstra kød", priceKroner: Number(meat[1]) });
      }

      // Unlabelled block: Menu-column products before a named section (e.g. GRILL)
      let section = state.section;
      if (
        state.priceMode === "base_menu" &&
        state.section !== "GRILL" &&
        !/^sandwich/i.test(state.section) &&
        (state.section === "UNKNOWN" ||
          state.section === "PIZZA" ||
          state.section.startsWith("UNLABELLED"))
      ) {
        section = `UNLABELLED_PAGE${page.pageNumber}`;
        state = { ...state, section };
      }

      // Keep base_menu hint when header said so; single price stays single in buildPricing
      // unless rendered fallback recovers the Menu column.
      let priceMode = variantInfo.mode;
      if (section.startsWith("UNLABELLED") && prices.length < 2) {
        priceMode = prices.length === 1 ? "single" : priceMode;
      }
      if (
        section.startsWith("UNLABELLED") &&
        prices.length >= 2 &&
        state.priceMode === "base_menu"
      ) {
        priceMode = "base_menu";
      }

      // Menu-column blocks are consecutive BASE+Menu pairs. After two single-price
      // rows, treat the Menu column as ended (e.g. Grill sides after burgers).
      if (state.priceMode === "base_menu") {
        if (prices.length >= 2) {
          consecutiveBaseMenuSingles = 0;
        } else {
          consecutiveBaseMenuSingles += 1;
          if (consecutiveBaseMenuSingles >= 2) {
            priceMode = prices.length === 1 ? "single" : priceMode;
            state = { ...state, priceMode: "single" };
          }
        }
      }

      seq += 1;
      const confidence =
        namePart && prices.length > 0
          ? 0.85
          : namePart
            ? 0.65
            : prices.length > 0
              ? 0.55
              : 0.35;

      const evidence: SourceEvidence = {
        sourceFile,
        pageNumber: page.pageNumber,
        rawText: rawBundle.slice(0, 600),
        sourceSection: section,
        imageRef: page.imageRef,
        confidence,
        extractorVersion: PDF_EXTRACTOR_VERSION,
      };

      candidates.push({
        candidateId: `cand-p${page.pageNumber}-${seq}`,
        pageNumber: page.pageNumber,
        menuNumber: anchor.menuNumber,
        ...(namePart ? { name: namePart } : {}),
        ...(ingredientText ? { ingredientText } : {}),
        rawPrices: prices,
        rawVariantNames:
          priceMode === "base_menu"
            ? ["BASE", "Menu"]
            : priceMode === "single"
              ? ["Alm."]
              : variantInfo.names,
        rawVariantPrices: prices,
        categoryHint: section,
        sectionHint: section,
        additions,
        choiceHints: slashChoiceHints(rawBundle),
        confidence,
        evidence,
        rawLineBundle: rawBundle,
        priceMode,
      });

      i = Math.max(j, i + 1);
    }
  }

  return applyRenderedPageFallback(
    fillAlmFamilieFromSection(attachSpatialAlmFamiliePrices(candidates, pages)),
    pages,
  );
}

/** @deprecated Use detectSourceCandidatesLayout — kept for import compatibility. */
export { detectSourceCandidatesLayout as detectSourceCandidates };
