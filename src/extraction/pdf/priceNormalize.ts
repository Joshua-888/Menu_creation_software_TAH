/**
 * Price-column normalization for scanned menus (Alm./Familie, BASE+Menu).
 * Evidence-based: never invents prices without section-pair evidence.
 */

export function repairOcrPriceText(text: string): string {
  return text
    .replace(/\bII5\b/gi, "115")
    .replace(/\bI15\b/gi, "115")
    .replace(/\bl15\b/gi, "115")
    // Leading I before a 2-digit price often drops the hundreds "1"
    .replace(/\bI(\d{2})\b/g, "1$1");
}

/** Drop tokens that are clearly the product's own menu number, not a price. */
export function stripMenuNumberFalsePrices(
  prices: number[],
  menuNumber: string | undefined,
): number[] {
  if (!menuNumber) return prices;
  const mn = Number(menuNumber.match(/^(\d+)/)?.[1] ?? NaN);
  if (!Number.isFinite(mn)) return prices;
  return prices.filter((p) => p !== mn);
}

/**
 * OCR sometimes drops the hundreds digit: "10, 210" → 110, 210.
 */
export function repairDroppedHundredsDigit(prices: number[]): number[] {
  if (prices.length < 2) return prices;
  const out = [...prices];
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    if (a < 40 && b >= 150 && a + 100 < b && b - (a + 100) >= 40) {
      out[i] = a + 100;
    }
  }
  return out;
}

/**
 * Pick Alm/Familie pair: smaller Alm, larger Familie.
 * Accepts inverted OCR order [180, 95].
 */
export function pickAlmFamiliePair(
  prices: number[],
): [number, number] | null {
  const vals = repairDroppedHundredsDigit(prices);
  if (vals.length < 2) return null;

  const uniq = [...new Set(vals)];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = 0; j < uniq.length; j++) {
      if (i === j) continue;
      const alm = uniq[i]!;
      const fam = uniq[j]!;
      if (alm < fam && alm >= 50 && fam <= 400 && fam - alm >= 40) {
        return [alm, fam];
      }
    }
  }

  // Last resort: sort first two distinct
  if (uniq.length >= 2) {
    const sorted = uniq.slice().sort((a, b) => a - b);
    const alm = sorted[0]!;
    const fam = sorted[sorted.length - 1]!;
    if (fam > alm) return [alm, fam];
  }
  return null;
}

/**
 * BASE+Menu: lower = BASE, higher = Menu (menu column is the upsell).
 */
export function pickBaseMenuPair(prices: number[]): [number, number] | null {
  const vals = [...new Set(prices)].filter((p) => p >= 20 && p <= 400);
  if (vals.length < 2) return null;
  const sorted = vals.slice().sort((a, b) => a - b);
  return [sorted[0]!, sorted[sorted.length - 1]!];
}

function pairKey(p: [number, number]): string {
  return `${p[0]}:${p[1]}`;
}

/**
 * For alm_familie candidates missing a pair:
 * 1) keep own recoverable pair
 * 2) if one price matches a neighbor's Alm or Familie, copy that neighbor pair
 * 3) if the section is uniform (same pair dominates), fill gaps from that pair
 * Never overwrite a product that already has its own distinct pair with a modal.
 */
export function fillAlmFamilieFromSection<
  T extends {
    candidateId: string;
    pageNumber: number;
    sectionHint?: string;
    categoryHint?: string;
    priceMode?: string;
    menuNumber?: string;
    rawPrices: number[];
    confidence: number;
  },
>(candidates: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const c of candidates) {
    if (c.priceMode !== "alm_familie") continue;
    const section = c.sectionHint ?? c.categoryHint ?? "";
    const key = `${c.pageNumber}::${section}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const updates = new Map<string, { prices: number[]; confidence: number }>();

  for (const [, group] of groups) {
    const sorted = group.slice().sort((a, b) => {
      const an = Number(a.menuNumber?.match(/^(\d+)/)?.[1] ?? 9999);
      const bn = Number(b.menuNumber?.match(/^(\d+)/)?.[1] ?? 9999);
      return an - bn;
    });

    const resolved: Array<[number, number] | null> = sorted.map((c) =>
      pickAlmFamiliePair(
        stripMenuNumberFalsePrices(c.rawPrices, c.menuNumber),
      ),
    );

    const pairCounts = new Map<string, { pair: [number, number]; n: number }>();
    for (const pair of resolved) {
      if (!pair) continue;
      const k = pairKey(pair);
      const cur = pairCounts.get(k);
      if (cur) cur.n += 1;
      else pairCounts.set(k, { pair, n: 1 });
    }
    let modal: [number, number] | null = null;
    let best = 0;
    for (const { pair, n } of pairCounts.values()) {
      if (n > best) {
        best = n;
        modal = pair;
      }
    }
    const sectionName = sorted[0]?.sectionHint ?? sorted[0]?.categoryHint ?? "";
    const uniformSection =
      /salatpizza|vegetarpizza/i.test(sectionName) ||
      (pairCounts.size <= 2 && best >= 3);

    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i]!;
      const cleaned = stripMenuNumberFalsePrices(c.rawPrices, c.menuNumber);
      const own = resolved[i];
      if (own) {
        updates.set(c.candidateId, { prices: own, confidence: c.confidence });
        continue;
      }

      // Neighbor match: single price equals neighbor Alm or Familie
      let fromNeighbor: [number, number] | null = null;
      if (cleaned.length === 1) {
        const only = cleaned[0]!;
        for (const j of [i - 1, i + 1]) {
          const nb = resolved[j];
          if (!nb) continue;
          if (only === nb[0] || only === nb[1]) {
            fromNeighbor = nb;
            break;
          }
        }
      }
      if (fromNeighbor) {
        updates.set(c.candidateId, {
          prices: fromNeighbor,
          confidence: Math.min(c.confidence, 0.72),
        });
        resolved[i] = fromNeighbor;
        continue;
      }

      if (uniformSection && modal) {
        if (cleaned.length === 0) {
          updates.set(c.candidateId, {
            prices: modal,
            confidence: Math.min(c.confidence, 0.65),
          });
          resolved[i] = modal;
          continue;
        }
        if (cleaned.length === 1) {
          const only = cleaned[0]!;
          const next: [number, number] =
            only === modal[0] || only === modal[1]
              ? modal
              : only > modal[0]
                ? [modal[0], Math.max(only, modal[1])]
                : modal;
          updates.set(c.candidateId, {
            prices: next,
            confidence: Math.min(c.confidence, 0.7),
          });
          resolved[i] = next;
          continue;
        }
      }

      updates.set(c.candidateId, {
        prices: cleaned,
        confidence: c.confidence,
      });
    }
  }

  return candidates.map((c) => {
    if (c.priceMode !== "alm_familie") return c;
    const next = updates.get(c.candidateId);
    if (!next) return c;
    return { ...c, rawPrices: next.prices, confidence: next.confidence };
  });
}
