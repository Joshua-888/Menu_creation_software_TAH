import { z } from "zod";
import { SourceEvidenceSchema } from "../evidence.js";
import type { ValidationCode } from "../errors.js";
import { MoneyMinorSchema } from "../money.js";
import { ValueOriginSchema } from "../provenance.js";
import { ValidationStatusSchema } from "../status.js";
import {
  CANONICAL_MENU_SCHEMA_VERSION,
  DOMAIN_RULE_ENGINE_VERSION,
} from "../versions.js";

export const CanonicalIngredientSchema = z.object({
  display: z.string().min(1),
  origin: ValueOriginSchema,
  evidence: SourceEvidenceSchema.optional(),
});

export type CanonicalIngredient = z.infer<typeof CanonicalIngredientSchema>;

export const CanonicalVariantSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  nameOrigin: ValueOriginSchema,
  surcharge: MoneyMinorSchema,
  surchargeOrigin: ValueOriginSchema,
  isBase: z.boolean(),
  sourceTotalPrice: MoneyMinorSchema.optional(),
  sourceExplicitSurcharge: MoneyMinorSchema.optional(),
  evidence: SourceEvidenceSchema.optional(),
});

export type CanonicalVariant = z.infer<typeof CanonicalVariantSchema>;

export const CanonicalAddOnSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  price: MoneyMinorSchema.optional(),
  origin: ValueOriginSchema,
  evidence: SourceEvidenceSchema.optional(),
});

export type CanonicalAddOn = z.infer<typeof CanonicalAddOnSchema>;

export const CanonicalProductChoiceOptionSchema = z.object({
  productSourceId: z.string().min(1),
  label: z.string().optional(),
});

export const CanonicalProductChoiceSchema = z.object({
  sourceId: z.string().min(1),
  prompt: z.string().min(1),
  options: z.array(CanonicalProductChoiceOptionSchema).min(1),
  evidence: SourceEvidenceSchema.optional(),
});

export type CanonicalProductChoice = z.infer<typeof CanonicalProductChoiceSchema>;

export const ValidationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  entityId: z.string(),
  field: z.string().optional(),
  severity: ValidationStatusSchema,
  evidence: SourceEvidenceSchema.optional(),
});

export type ValidationIssue = z.infer<typeof ValidationIssueSchema> & {
  code: ValidationCode | string;
};

export const CanonicalProductSchema = z.object({
  sourceId: z.string().min(1),
  categorySourceId: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  sourceMenuNumber: z.string().optional(),
  assignedMenuNumber: z.string().optional(),
  sourceOrder: z.number().int(),
  basePrice: MoneyMinorSchema.optional(),
  basePriceOrigin: ValueOriginSchema.optional(),
  ingredients: z.array(CanonicalIngredientSchema),
  variants: z.array(CanonicalVariantSchema),
  addOns: z.array(CanonicalAddOnSchema),
  productChoices: z.array(CanonicalProductChoiceSchema),
  isCombo: z.boolean(),
  status: ValidationStatusSchema,
  issues: z.array(ValidationIssueSchema),
  evidence: SourceEvidenceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type CanonicalProduct = z.infer<typeof CanonicalProductSchema>;

export const CanonicalCategorySchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  sourceOrder: z.number().int(),
  commonIngredients: z.array(CanonicalIngredientSchema),
  products: z.array(CanonicalProductSchema),
  evidence: SourceEvidenceSchema.optional(),
});

export type CanonicalCategory = z.infer<typeof CanonicalCategorySchema>;

export const CanonicalMenuSchema = z.object({
  restaurantName: z.string().min(1),
  sourceInfo: z.string().optional(),
  destinationInfo: z.string().optional(),
  categories: z.array(CanonicalCategorySchema),
  schemaVersion: z.literal(CANONICAL_MENU_SCHEMA_VERSION),
  domainRulesVersion: z.literal(DOMAIN_RULE_ENGINE_VERSION),
  extractionVersion: z.string().optional(),
  status: ValidationStatusSchema,
  issues: z.array(ValidationIssueSchema),
});

export type CanonicalMenu = z.infer<typeof CanonicalMenuSchema>;

export const ValidationReportSchema = z.object({
  status: ValidationStatusSchema,
  issues: z.array(ValidationIssueSchema),
  productCount: z.number().int().nonnegative(),
  readyCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});

export type ValidationReport = z.infer<typeof ValidationReportSchema>;
