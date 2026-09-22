"use client";

import { useMemo, useState } from "react";
import type {
  CanonicalMenu,
  MenuQualityContractResult,
  SourceMenu,
} from "@engine/portal/menuView.js";
import {
  buildMenuSections,
  menuQualityLabel,
  menuQualityTone,
  type MenuProductView,
  type MenuStatusFilter,
} from "@engine/portal/menuView.js";
import { Badge } from "../ui/Badge";
import { Panel } from "../ui/Panel";
import { CategorySection } from "./CategorySection";
import { MenuFilterBar } from "./MenuFilterBar";
import { ProductProvenanceModal } from "./ProductProvenanceModal";

/**
 * Read-only TargetMenu browser. Renders the produced canonical menu as a
 * category → product tree with search, status filtering and per-product
 * provenance. All filtering is presentation-only; no menu semantics are
 * recomputed here.
 */
export function MenuView({
  targetMenu,
  qualityContract,
  sourceMenu,
  jobId,
}: {
  targetMenu: CanonicalMenu | null;
  qualityContract: MenuQualityContractResult | null;
  sourceMenu: SourceMenu | null;
  jobId: string;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<MenuStatusFilter>("ALL");
  const [inspectId, setInspectId] = useState<string | null>(null);

  const allSections = useMemo(
    () =>
      buildMenuSections({
        targetMenu,
        qualityContract,
        sourceMenu,
        query: "",
        statusFilter: "ALL",
      }),
    [targetMenu, qualityContract, sourceMenu],
  );

  const counts = useMemo(() => {
    const result: Record<MenuStatusFilter, number> = {
      ALL: 0,
      READY: 0,
      REVIEW: 0,
      BLOCKED: 0,
    };
    for (const category of allSections) {
      result.ALL += category.productCount;
      result.READY += category.statusCounts.READY;
      result.REVIEW += category.statusCounts.REVIEW;
      result.BLOCKED += category.statusCounts.BLOCKED;
    }
    return result;
  }, [allSections]);

  const sections = useMemo(
    () =>
      buildMenuSections({
        targetMenu,
        qualityContract,
        sourceMenu,
        query,
        statusFilter,
      }),
    [targetMenu, qualityContract, sourceMenu, query, statusFilter],
  );

  const inspectView = useMemo<MenuProductView | null>(() => {
    if (!inspectId) return null;
    for (const category of allSections) {
      for (const view of category.products) {
        if (view.product.sourceId === inspectId) return view;
      }
    }
    return null;
  }, [inspectId, allSections]);

  if (!targetMenu) {
    return (
      <Panel title="Target menu">
        <p className="muted">No TargetMenu artifact for this job yet.</p>
      </Panel>
    );
  }

  const productCount = counts.ALL;
  const visibleCount = sections.reduce(
    (total, category) => total + category.products.length,
    0,
  );

  return (
    <Panel title="Target menu">
      <div className="menu-view">
        <div className="menu-view-head">
          <div className="menu-view-meta">
            <Badge tone={menuQualityTone(qualityContract?.menuStatus)}>
              {menuQualityLabel(qualityContract?.menuStatus)}
            </Badge>
            <span className="muted">
              {targetMenu.restaurantName} · {productCount} product
              {productCount === 1 ? "" : "s"} · {sections.length} categor
              {sections.length === 1 ? "y" : "ies"}
            </span>
          </div>
        </div>

        <MenuFilterBar
          query={query}
          onQueryChange={setQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          counts={counts}
        />

        {sections.length > 0 ? (
          <nav className="menu-jump-nav" aria-label="Jump to category">
            {sections.map((category) => (
              <a
                key={category.sourceId}
                className="menu-jump-link"
                href={`#category-${category.sourceId}`}
              >
                {category.name}
              </a>
            ))}
          </nav>
        ) : null}

        {sections.length === 0 ? (
          <p className="muted">
            {productCount === 0
              ? "This menu has no products."
              : "No products match the current search or filter."}
          </p>
        ) : (
          <div className="menu-sections">
            {sections.map((category) => (
              <CategorySection
                key={category.sourceId}
                category={category}
                jobId={jobId}
                onInspect={setInspectId}
              />
            ))}
          </div>
        )}

        {(query !== "" || statusFilter !== "ALL") && sections.length > 0 ? (
          <p className="muted">
            Showing {visibleCount} of {productCount} products.
          </p>
        ) : null}
      </div>

      {inspectView ? (
        <ProductProvenanceModal
          view={inspectView}
          onClose={() => setInspectId(null)}
        />
      ) : null}
    </Panel>
  );
}
