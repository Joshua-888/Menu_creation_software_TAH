import { z } from "zod";

export const ValueOriginSchema = z.enum([
  "SOURCE",
  "DERIVED",
  "SYSTEM_DEFAULT",
  "HUMAN_CORRECTION",
]);

export type ValueOrigin = z.infer<typeof ValueOriginSchema>;
