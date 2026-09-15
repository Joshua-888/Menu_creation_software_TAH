/**
 * Apply pizza/calzone topping recovery onto CanonicalMenu, then revalidate issues.
 * Lives outside `domain` so domain does not depend on learning.
 */

import type {
  CanonicalMenu,
  ValidationReport,
} from "../domain/schema/canonical.js";
import { revalidateCanonicalIssues } from "../domain/issueLifecycle.js";
import { buildValidationReport } from "../domain/validation.js";
import { aggregateStatus } from "../domain/status.js";
import {
  proposePizzaToppingsFromDescription,
  type PizzaToppingProposal,
} from "../learning/pizzaToppings.js";

export type PizzaToppingRecoveryResult = {
  menu: CanonicalMenu;
  validation: ValidationReport;
  recovered: Array<{
    sourceId: string;
    menuNumber: string | null;
    name: string;
    proposal: PizzaToppingProposal;
  }>;
};

export function applyPizzaToppingRecovery(
  menu: CanonicalMenu,
): PizzaToppingRecoveryResult {
  const recovered: PizzaToppingRecoveryResult["recovered"] = [];

  const categories = menu.categories.map((cat) => ({
    ...cat,
    products: cat.products.map((p) => {
      const existing = (p.ingredients ?? []).map((i) => i.display);
      const proposal = proposePizzaToppingsFromDescription({
        name: p.name,
        categoryName: cat.name,
        description: p.description ?? "",
        existingIngredients: existing,
      });
      if (!proposal) return p;
      recovered.push({
        sourceId: p.sourceId,
        menuNumber: p.sourceMenuNumber ?? p.assignedMenuNumber ?? null,
        name: p.name,
        proposal,
      });
      return {
        ...p,
        ingredients: proposal.ingredients.map((display) => ({
          display,
          origin: "DERIVED" as const,
        })),
      };
    }),
  }));

  const withIngredients: CanonicalMenu = { ...menu, categories };
  const { menu: revalidated } = revalidateCanonicalIssues(withIngredients);

  const productStatuses = revalidated.categories.flatMap((c) =>
    c.products.map((p) => p.status),
  );
  const menuStatus = aggregateStatus([
    ...revalidated.issues.map((i) => i.severity),
    ...productStatuses,
  ]);
  const finalMenu: CanonicalMenu = { ...revalidated, status: menuStatus };
  const validation = buildValidationReport(finalMenu);

  return { menu: finalMenu, validation, recovered };
}
