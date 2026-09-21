/**
 * Parse source description / evidence lines into combo components and choices.
 * Never invent tokens that are not in the source text (except splitting lists).
 */

export type ParsedSourceComponents = {
  ingredients: string[];
  productChoices: Array<{ prompt: string; options: string[] }>;
};

const CHOICE_SPLIT = /\s+(?:el\.|eller)\s+/i;

export function splitDanishFoodList(text: string): string[] {
  return text
    .split(/\s*,\s*|\s+\bog\s+/i)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 2 && !/^kr\.?\s*\d/i.test(t));
}

export function parseChoiceOptions(text: string): string[] {
  if (!CHOICE_SPLIT.test(text)) return [];
  return text
    .split(CHOICE_SPLIT)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 2);
}

/** Drop the title/price line so remaining evidence is the printed description. */
export function descriptionLinesFromEvidence(
  productName: string,
  rawText: string | undefined,
): string {
  if (!rawText?.trim()) return "";
  const nameHead = productName.trim().toLowerCase().slice(0, 18);
  const lines = rawText
    // Reconcile joins evidence fragments with " || " — that is a structural
    // merge boundary, not dish content, so treat it as a line break.
    .split(/\r?\n|\s\|\|\s*/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((l) => !/^kr\.?\s*\d/i.test(l))
    .filter((l) => !l.toLowerCase().startsWith(nameHead));
  return lines.join(", ");
}

export function parseSourceComponents(input: {
  name: string;
  description?: string;
  rawText?: string;
  existingIngredients?: string[];
}): ParsedSourceComponents {
  const fromEvidence = descriptionLinesFromEvidence(input.name, input.rawText);
  const blobs = [
    ...(input.existingIngredients ?? []),
    input.description ?? "",
    fromEvidence,
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^menu\s*:/i.test(s));

  const ingredients: string[] = [];
  const productChoices: Array<{ prompt: string; options: string[] }> = [];
  const seen = new Set<string>();

  const pushIng = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 2) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ingredients.push(t);
  };

  for (const blob of blobs) {
    for (const part of splitDanishFoodList(blob)) {
      const nested = parseChoiceOptions(part);
      if (nested.length >= 2) {
        productChoices.push({ prompt: "Vælg", options: nested });
        continue;
      }
      pushIng(part);
    }
  }

  return { ingredients, productChoices };
}
