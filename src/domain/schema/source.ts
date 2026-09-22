import { z } from "zod";
import { SourceEvidenceSchema } from "../evidence.js";
import { MoneyMinorSchema } from "../money.js";
import { ValueOriginSchema } from "../provenance.js";

export const SourceIdSchema = z.string().min(1);

export const SourceIngredientSchema = z.object({
  display: z.string().min(1),
  origin: ValueOriginSchema.default("SOURCE"),
  evidence: SourceEvidenceSchema.optional(),
});

export type SourceIngredient = z.infer<typeof SourceIngredientSchema>;

export const SourceVariantSchema = z.object({
  sourceId: SourceIdSchema,
  name: z.string().min(1),
  /** Absolute price on the source menu, if present. */
  sourceTotalPrice: MoneyMinorSchema.optional(),
  /** Explicit surcharge like "+80" already expressed as surcharge. */
  sourceExplicitSurcharge: MoneyMinorSchema.optional(),
  /**
   * Provenance of `sourceTotalPrice`. Absent/`SOURCE` means the price was read
   * directly; `DERIVED` marks a group-inherited price (uniform sub-section).
   */
  priceOrigin: ValueOriginSchema.optional(),
  evidence: SourceEvidenceSchema.optional(),
});

export type SourceVariant = z.infer<typeof SourceVariantSchema>;

export const SourceAddOnSchema = z.object({
  sourceId: SourceIdSchema,
  name: z.string().min(1),
  price: MoneyMinorSchema.optional(),
  evidence: SourceEvidenceSchema.optional(),
});

export type SourceAddOn = z.infer<typeof SourceAddOnSchema>;

export const SourceProductChoiceOptionSchema = z.object({
  /** Stable reference to another product entity — never a display name. */
  productSourceId: SourceIdSchema,
  label: z.string().optional(),
});

export const SourceProductChoiceSchema = z.object({
  sourceId: SourceIdSchema,
  prompt: z.string().min(1),
  options: z.array(SourceProductChoiceOptionSchema).min(1),
  required: z.boolean().optional(),
  minSelections: z.number().int().positive().optional(),
  maxSelections: z.number().int().positive().optional(),
  evidence: SourceEvidenceSchema.optional(),
});

export type SourceProductChoice = z.infer<typeof SourceProductChoiceSchema>;

export const SourceProductSchema = z.object({
  sourceId: SourceIdSchema,
  name: z.string(),
  description: z.string().optional(),
  sourceMenuNumber: z.string().optional(),
  sourceOrder: z.number().int(),
  ingredients: z.array(SourceIngredientSchema).default([]),
  variants: z.array(SourceVariantSchema).default([]),
  /**
   * Raw source price columns/options before deciding variant vs choice semantics.
   * Example: BASE 75 + Menu 125.
   */
  sourcePriceOptions: z
    .array(
      z.object({
        label: z.string().min(1),
        sourceTotalPrice: MoneyMinorSchema.optional(),
      }),
    )
    .optional(),
  addOns: z.array(SourceAddOnSchema).default([]),
  productChoices: z.array(SourceProductChoiceSchema).default([]),
  isCombo: z.boolean().default(false),
  evidence: SourceEvidenceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type SourceProduct = z.infer<typeof SourceProductSchema>;

export const SourceCategorySchema = z.object({
  sourceId: SourceIdSchema,
  name: z.string().min(1),
  sourceOrder: z.number().int(),
  commonIngredients: z.array(SourceIngredientSchema).default([]),
  products: z.array(SourceProductSchema).default([]),
  evidence: SourceEvidenceSchema.optional(),
});

export type SourceCategory = z.infer<typeof SourceCategorySchema>;

export const SourceMenuSchema = z.object({
  restaurantName: z.string().min(1),
  sourceInfo: z.string().optional(),
  destinationInfo: z.string().optional(),
  categories: z.array(SourceCategorySchema),
  extractionVersion: z.string().optional(),
});

export type SourceMenu = z.infer<typeof SourceMenuSchema>;
