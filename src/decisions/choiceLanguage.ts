/**
 * Choice-language evidence strength — slash alone is weaker than vælg/eller.
 */

export type ChoiceLanguageStrength =
  | "VERY_STRONG"
  | "STRONG"
  | "WEAK"
  | "NONE";

export function classifyChoiceLanguageStrength(sourceText: string): {
  strength: ChoiceLanguageStrength;
  markers: string[];
  enumeratedOptions: string[];
} {
  const markers: string[] = [];
  const t = sourceText;

  if (/\bvælg mellem\b/i.test(t) || /\bvaelg mellem\b/i.test(t)) {
    markers.push("VAELG_MELLEM");
  }
  if (/\bvalgfrit\b/i.test(t)) markers.push("VALGFRIT");
  if (/\bvælg selv\b/i.test(t) || /\bvaelg selv\b/i.test(t)) {
    markers.push("VAELG_SELV");
  }
  if (/\beller\b/i.test(t)) markers.push("ELLER");
  const slash = /\w\s*\/\s*\w/.test(t);
  if (slash) markers.push("SLASH");

  const enumeratedOptions = extractEnumeratedOptions(t);

  if (
    markers.includes("VAELG_MELLEM") ||
    markers.includes("VAELG_SELV") ||
    (markers.includes("VALGFRIT") && enumeratedOptions.length >= 2)
  ) {
    return { strength: "VERY_STRONG", markers, enumeratedOptions };
  }
  if (markers.includes("ELLER") && enumeratedOptions.length >= 2) {
    return { strength: "VERY_STRONG", markers, enumeratedOptions };
  }
  if (markers.includes("VALGFRIT") || markers.includes("ELLER")) {
    return { strength: "STRONG", markers, enumeratedOptions };
  }
  if (slash) {
    return {
      strength: enumeratedOptions.length >= 2 ? "WEAK" : "WEAK",
      markers,
      enumeratedOptions,
    };
  }
  return { strength: "NONE", markers, enumeratedOptions };
}

/** Extract source-supported option labels — never invent beyond text. */
export function extractEnumeratedOptions(sourceText: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const label = raw
      .replace(/^[-•*]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (label.length < 2 || label.length > 40) return;
    if (/^\d+[.,]?\d*$/.test(label)) return;
    if (/^(ingredients?|choices?|source|product)/i.test(label)) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  // "Vælg mellem: - A - B - C" or bullet lines (also OCR-tolerant)
  const afterVaelg = sourceText.match(
    /v[æa]lg mellem\s*:?\s*([\s\S]{0,400})/i,
  );
  if (afterVaelg) {
    const chunk = afterVaelg[1]!;
    // Prefer inline "- Option" tokens (common OCR/PDF flatten form)
    const dashParts = chunk.split(/\s*-\s+/).map((s) => s.trim());
    if (dashParts.length >= 2) {
      for (const part of dashParts) {
        const cleaned = part
          .split(/[,\n|]/)[0]!
          .replace(/^(valg|choices?|source)\b.*/i, "")
          .trim();
        if (
          cleaned.length >= 2 &&
          /^[A-Za-zÆØÅæøå]/.test(cleaned) &&
          !/^\d/.test(cleaned)
        ) {
          push(cleaned.split(/\s+/).slice(0, 3).join(" "));
        }
      }
    }
    if (out.length < 2) {
      for (const m of chunk.matchAll(
        /[-•]\s*([A-Za-zÆØÅæøå][^,\n|/]{1,40})/g,
      )) {
        push(m[1]!);
      }
    }
  }

  // "X eller Y" (possibly "med …")
  const eller = sourceText.match(
    /\b([A-Za-zÆØÅæøå][\wÆØÅæøå-]{1,30})\s+eller\s+([A-Za-zÆØÅæøå][\wÆØÅæøå-]{1,30})\b/i,
  );
  if (eller) {
    push(eller[1]!);
    push(eller[2]!);
  }

  // Slash lists: a/b/c (not prices)
  const slashLists = sourceText.matchAll(
    /\b([A-Za-zÆØÅæøå][\wÆØÅæøå-]{1,20}(?:\s*\/\s*[A-Za-zÆØÅæøå][\wÆØÅæøå-]{1,20}){1,5})\b/g,
  );
  for (const m of slashLists) {
    const parts = m[1]!.split(/\s*\/\s*/);
    if (parts.every((p) => p.length >= 2 && !/^\d/.test(p))) {
      for (const p of parts) push(p);
    }
  }

  return out;
}

export const VERONI_VAELG_SELV_OPTIONS = [
  "Kebab",
  "Kylling",
  "Skinke",
  "Falafel",
  "Mix",
] as const;

export function choiceOptionSourceId(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `choice-opt:${slug}`;
}

export function isSyntheticChoiceOptionId(id: string): boolean {
  return id.startsWith("choice-opt:");
}
