import { readFileSync } from "node:fs";
import type { SourceCandidate } from "../pdf/types.js";
import { PDF_EXTRACTOR_VERSION } from "../pdf/types.js";

export type VisionMenuExtractorInput = {
  filePath: string;
  sourceFile: string;
  pageNumber: number;
};

/**
 * Optional escalation boundary. The deterministic OCR/layout path remains the
 * baseline; deployments may inject a different implementation without
 * coupling the PDF adapter to a model vendor.
 */
export interface VisionMenuExtractor {
  readonly id: string;
  extract(input: VisionMenuExtractorInput): Promise<SourceCandidate[]>;
}

type VisionProduct = {
  name: string;
  description?: string;
  priceKroner?: number;
  category?: string;
  confidence?: number;
  region?: { x: number; y: number; width: number; height: number };
};

function supportedCategory(
  product: VisionProduct,
): string | undefined {
  const category = product.category?.trim();
  if (!category) return undefined;
  const text = `${product.name} ${product.description ?? ""}`;
  if (/pizza/i.test(category) && !/\b(pizza|calzone|ufo)\b/i.test(text)) {
    return undefined;
  }
  if (/burger/i.test(category) && !/\b(burger|smash|hamburger)\b/i.test(text)) {
    return undefined;
  }
  return category;
}

export class OpenAiVisionMenuExtractor implements VisionMenuExtractor {
  readonly id = "openai-vision-structured";

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
  ) {}

  async extract(input: VisionMenuExtractorInput): Promise<SourceCandidate[]> {
    const bytes = readFileSync(input.filePath);
    const extension = input.filePath.toLowerCase().endsWith(".png")
      ? "png"
      : input.filePath.toLowerCase().endsWith(".webp")
        ? "webp"
        : "jpeg";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract only visually printed sellable menu products. Do not infer missing prices or categories. Return JSON {products:[{name,description,priceKroner,category,confidence,region:{x,y,width,height}}]}. Coordinates are normalized 0..1. Handwriting is not menu content.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract this photographed menu." },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/${extension};base64,${bytes.toString("base64")}`,
                },
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Vision extraction failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content) as { products?: VisionProduct[] };
    return (parsed.products ?? [])
      .filter(
        (product) =>
          product.name?.trim() &&
          typeof product.priceKroner === "number" &&
          product.priceKroner > 0,
      )
      .map((product, index) => {
        const confidence = Math.max(0, Math.min(1, product.confidence ?? 0.82));
        const category = supportedCategory(product);
        const evidenceText = [
          product.name,
          product.description,
          product.priceKroner ? `Kr. ${product.priceKroner}` : undefined,
        ]
          .filter(Boolean)
          .join("\n");
        return {
          candidateId: `vision-p${input.pageNumber}-${index + 1}`,
          pageNumber: input.pageNumber,
          name: product.name.trim(),
          ...(product.description
            ? {
                description: product.description.trim(),
                ingredientText: product.description.trim(),
              }
            : {}),
          rawPrices: [product.priceKroner!],
          rawVariantNames: ["Alm."],
          rawVariantPrices: [product.priceKroner!],
          priceMode: "single" as const,
          ...(category
            ? {
                categoryHint: category,
                sectionHint: category,
              }
            : {}),
          additions: [],
          choiceHints: [],
          confidence,
          evidence: {
            sourceFile: input.sourceFile,
            pageNumber: input.pageNumber,
            rawText: evidenceText,
            confidence,
            origin: "SOURCE_VISION" as const,
            ...(product.region
              ? { region: { ...product.region, pageNumber: input.pageNumber } }
              : {}),
            extractorVersion: PDF_EXTRACTOR_VERSION,
          },
          rawLineBundle: evidenceText,
          readingOrder: index,
        };
      });
  }
}

export function configuredVisionMenuExtractor():
  | VisionMenuExtractor
  | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key ? new OpenAiVisionMenuExtractor(key) : undefined;
}
