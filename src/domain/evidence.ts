import { z } from "zod";

export const SourceEvidenceSchema = z.object({
  sourceUrl: z.string().optional(),
  sourceFile: z.string().optional(),
  rawText: z.string().optional(),
  pageNumber: z.number().int().positive().optional(),
  sourceSection: z.string().optional(),
  domLocation: z.string().optional(),
  imageRef: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  extractorVersion: z.string().optional(),
});

export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;
