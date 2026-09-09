import { z } from "zod";

/** Integer øre (DKK × 100). Never use floats in domain arithmetic. */
export const MoneyMinorSchema = z.number().int();
export type MoneyMinor = z.infer<typeof MoneyMinorSchema>;

export function kronerToOre(kroner: number): MoneyMinor {
  return Math.round(kroner * 100);
}
