"use client";

import Link from "next/link";
import type { MenuProductView } from "@engine/portal/menuView.js";
import {
  formatDkk,
  originLabel,
  type BadgeTone,
} from "@engine/portal/menuView.js";
import { Badge } from "../ui/Badge";

function OriginChip({ origin }: { origin: string | null | undefined }) {
  if (!origin) return null;
  return <span className="origin-chip">{originLabel(origin as never)}</span>;
}

function issueTone(severity: string): BadgeTone {
  if (severity === "BLOCKED") return "danger";
  if (severity === "MANUAL_REVIEW_REQUIRED" || severity === "WARNING") {
    return "warn";
  }
  return "neutral";
}

/**
 * One product card in the TargetMenu browser. Read-only: it renders the values
 * the pipeline produced and never recalculates or edits them. Products that
 * need attention link to the existing authoritative review queue instead of
 * allowing inline edits.
 */
export function ProductCard({
  view,
  jobId,
  onInspect,
}: {
  view: MenuProductView;
  jobId: string;
  onInspect: (productSourceId: string) => void;
}) {
  const { product, quality, status } = view;
  const hasReviewLink = status === "REVIEW" || status === "BLOCKED";
  const issues = product.issues ?? [];
  const blockers = quality?.blockers ?? [];
  const warnings = quality?.completenessWarnings ?? [];

  return (
    <article className="product-card">
      <div className="product-card-head">
        <div className="product-card-ident">
          {view.menuNumber ? (
            <span className="product-menu-number">#{view.menuNumber}</span>
          ) : null}
          <h4 className="product-name">{product.name}</h4>
          <Badge tone={view.tone}>{view.statusLabel}</Badge>
          {product.isCombo ? <span className="workflow-pill">Combo</span> : null}
        </div>
        <div className="product-card-price">{view.priceLabel}</div>
      </div>

      {product.description ? (
        <p className="product-description">{product.description}</p>
      ) : (
        <p className="muted product-description">No description.</p>
      )}

      {product.ingredients.length > 0 ? (
        <div className="chip-row">
          {product.ingredients.map((ingredient) => (
            <span
              className="chip"
              key={`${product.sourceId}-ing-${ingredient.display}`}
            >
              {ingredient.display}
              <OriginChip origin={ingredient.origin} />
            </span>
          ))}
        </div>
      ) : null}

      {product.variants.length > 0 ? (
        <div className="product-subsection">
          <span className="product-subsection-title">Variants</span>
          <div className="chip-row">
            {product.variants.map((variant) => (
              <span className="chip" key={variant.sourceId}>
                {variant.name}
                {variant.surcharge > 0 ? (
                  <span className="chip-amount">
                    +{formatDkk(variant.surcharge)}
                  </span>
                ) : null}
                <OriginChip origin={variant.nameOrigin} />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {product.addOns.length > 0 ? (
        <div className="product-subsection">
          <span className="product-subsection-title">Tilbehør</span>
          <div className="chip-row">
            {product.addOns.map((addOn) => (
              <span className="chip" key={addOn.sourceId}>
                {addOn.name}
                {addOn.price != null ? (
                  <span className="chip-amount">{formatDkk(addOn.price)}</span>
                ) : null}
                <OriginChip origin={addOn.origin} />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {product.productChoices.length > 0 ? (
        <div className="product-subsection">
          <span className="product-subsection-title">Choices</span>
          <ul className="product-choice-list">
            {product.productChoices.map((choice) => (
              <li key={choice.sourceId}>
                <strong>{choice.prompt}</strong>
                <span className="muted">
                  {choice.required ? " · required" : ""}
                  {choice.minSelections != null
                    ? ` · min ${choice.minSelections}`
                    : ""}
                  {choice.maxSelections != null
                    ? ` · max ${choice.maxSelections}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blockers.length > 0 ? (
        <div className="product-alert product-alert-danger">
          {blockers.map((blocker) => (
            <div key={blocker}>{blocker}</div>
          ))}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="product-alert product-alert-warn">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="product-subsection">
          <span className="product-subsection-title">Validation issues</span>
          <ul className="product-issue-list">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.entityId}-${index}`}>
                <Badge tone={issueTone(issue.severity)}>{issue.code}</Badge>{" "}
                <span className="muted">{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="product-card-actions">
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          onClick={() => onInspect(product.sourceId)}
        >
          Inspect provenance
        </button>
        {hasReviewLink ? (
          <Link
            className="btn btn-secondary btn-compact"
            href={`/review?job=${jobId}&product=${encodeURIComponent(product.sourceId)}`}
          >
            Review item →
          </Link>
        ) : null}
      </div>
    </article>
  );
}
