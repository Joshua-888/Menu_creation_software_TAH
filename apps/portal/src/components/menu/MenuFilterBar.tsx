"use client";

import type { MenuStatusFilter } from "@engine/portal/menuView.js";

const FILTERS: Array<{ value: MenuStatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "READY", label: "Ready" },
  { value: "REVIEW", label: "Review" },
  { value: "BLOCKED", label: "Blocked" },
];

/**
 * Search + status filter for the TargetMenu browser.
 *
 * Client-side display filtering only — it narrows the already-rendered view and
 * never mutates or re-derives menu semantics.
 */
export function MenuFilterBar({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  counts,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: MenuStatusFilter;
  onStatusFilterChange: (value: MenuStatusFilter) => void;
  counts: Record<MenuStatusFilter, number>;
}) {
  return (
    <div className="menu-toolbar">
      <div className="menu-search">
        <label className="menu-search-label" htmlFor="menu-search-input">
          Search menu
        </label>
        <input
          id="menu-search-input"
          type="search"
          value={query}
          placeholder="Name, number, description or ingredient"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="filter-pills" role="group" aria-label="Status filter">
        {FILTERS.map((filter) => {
          const active = filter.value === statusFilter;
          return (
            <button
              key={filter.value}
              type="button"
              className={`filter-pill${active ? " filter-pill-active" : ""}`}
              aria-pressed={active}
              onClick={() => onStatusFilterChange(filter.value)}
            >
              {filter.label}
              <span className="filter-pill-count">{counts[filter.value]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
