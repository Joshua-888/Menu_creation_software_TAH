"use client";

import type {
  MenuCategoryView,
  MenuDisplayStatus,
} from "@engine/portal/menuView.js";
import { Badge } from "../ui/Badge";
import { ProductCard } from "./ProductCard";

export function CategorySection({
  category,
  jobId,
  onInspect,
}: {
  category: MenuCategoryView;
  jobId: string;
  onInspect: (productSourceId: string) => void;
}) {
  const counts: MenuDisplayStatus[] = ["READY", "REVIEW", "BLOCKED"];

  return (
    <section className="menu-category" id={`category-${category.sourceId}`}>
      <header className="menu-category-head">
        <h3 className="menu-category-title">{category.name}</h3>
        <div className="menu-category-meta">
          <span className="muted">
            {category.productCount} product
            {category.productCount === 1 ? "" : "s"}
          </span>
          {counts
            .filter((status) => category.statusCounts[status] > 0)
            .map((status) => (
              <Badge
                key={status}
                tone={
                  status === "READY"
                    ? "ok"
                    : status === "BLOCKED"
                      ? "danger"
                      : "warn"
                }
              >
                {status === "REVIEW" ? "review" : status.toLowerCase()}:{" "}
                {category.statusCounts[status]}
              </Badge>
            ))}
        </div>
      </header>
      {category.products.length === 0 ? (
        <p className="muted">No products match the current filter.</p>
      ) : (
        <div className="menu-product-list">
          {category.products.map((view) => (
            <ProductCard
              key={view.product.sourceId}
              view={view}
              jobId={jobId}
              onInspect={onInspect}
            />
          ))}
        </div>
      )}
    </section>
  );
}
