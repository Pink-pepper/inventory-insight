# Package 3 — Demand Planning & Inventory Planning Workspace

Builds Ionic's first planning workspace on the Package 1 and 2 foundations. No new forecasting maths beyond a transparent, explainable baseline; no changes to the existing recommendation engine's classifications.

## What the data actually supports today

Verified against the workspace database before writing this plan:

- Monthly demand (`sales`): 1,802 rows spanning 2025-09 to 2026-08 across 157 products — this is the real demand history.
- Day-grain demand (`sales_transactions`): 2 rows only (from the Package 2 import test). Channel, customer and location are attached to those 2 rows.
- Locations: 3 rows; no country/state values in use yet.
- Commercial: `products.unit_price` set on 2 of 157 products; `sales.cogs` set on 0 rows.

Consequences the implementation must honour rather than paper over:

- Day and week grain are only meaningful where transactions exist. The workspace will compute them from `sales_transactions` and state plainly when a selection has no transaction coverage, falling back to monthly with a visible notice.
- Channel, customer, region and state dimensions are shown only when the loaded data contains them; otherwise the selector shows them as unavailable with the reason (no dimension data ingested), never as empty charts.
- Margin, COGS and selling-price filters render as "not available" wherever price/COGS is missing, consistent with how the engine already reports missing lead time.

## 1. Navigation

Add one item, "Demand Planning", to the existing sidebar between Overview and Inventory. Inventory keeps its route and is upgraded in place. No visual redesign, no other nav change.

## 2. Demand data service (server-side)

New `src/lib/demand/` module, engine-style (no React, no Supabase imports):

- `series.ts` — builds a demand series from facts at a requested grain using the Package 1 `time-grain` utilities. Monthly-and-coarser grains read `sales`; day/week read `sales_transactions`. Returns buckets plus a coverage descriptor (source used, first/last period, number of periods, whether the grain was downgraded).
- `baseline.ts` — the demand baseline (below).
- `dimensions.ts` — pivots the series by a chosen dimension (product, category, supplier, channel, customer, location, region, state) and reports which dimensions the data actually populates.

New repository loader `loadDemandFacts(supabase, orgId, filter)` fetching monthly sales and transactions with joins for product/supplier/customer/channel/location, org-scoped and RLS-backed, then applying the shared `planningFilter` server-side. Reuses `applyPlanningFilter` / `withinRange`; the filter schema gains only `channelCodes`, `customerRefs` and a `compare` mode (`prev` | `yoy` | `none`) — no page-specific filter code.

## 3. Demand baseline (transparent)

Method: trailing average over the configured historical window, at the selected grain, optionally adjusted by the organisation's growth/decline setting, projected across the configured planning horizon.

```text
baseline_per_period = mean(demand over demandWindowMonths, at selected grain)
planned_per_period  = baseline_per_period * (1 + demandGrowthPct/100)
planned_total       = planned_per_period * periods_in(planningHorizonDays)
```

Every output carries its inputs: window used, number of periods found, source table, growth applied, horizon, and any limitation (fewer periods than the window, no history, grain downgraded). If fewer than two periods of history exist for a selection, no baseline is produced — the workspace says why.

Variability is reported, not modelled: coefficient of variation of the historical buckets, labelled Stable / Variable / Volatile with the thresholds shown.

### Policy parameters — activated vs still stored

Activated in Package 3 (they change demand-plan numbers, and the UI says how):
- `demandWindowMonths` (history used), `planningHorizonDays` (projection length), `demandGrowthPct` (baseline adjustment), `demandMethod` (currently one method: trailing average).

Remains stored-only and labelled as not applied: `seasonalityEnabled` (12 months of history is one seasonal cycle — insufficient to derive indices defensibly), `demandVariability` (an override the baseline does not consume; observed variability is computed from data instead), `serviceLevel` and `leadTimeVariabilityDays` (belong to a safety-stock model that is Supply Planning scope), plus the reorder/min/target/days-of-cover overrides which stay owned by the inventory engine.

No confidence/accuracy score is invented. Only a data-sufficiency indicator (periods available vs window requested, source, dimension coverage) is shown.

## 4. Demand Planning workspace UI

Route `src/routes/_authenticated/demand-planning.tsx`, using existing panels, tables, badges and recharts:

- One filter bar (new reusable `planning-filters.tsx`): search/SKU, category, supplier, location/region/state, channel/customer where available, date range, grain, comparison mode. Composable — every selection narrows the same server query. Unavailable dimensions are disabled with an explanation.
- Summary strip: total demand for the period, change vs comparison window, active SKU count, variability label, baseline per period.
- Trend chart: historical buckets plus the baseline projection, visually distinguished as projection.
- Comparison view: current vs prior/YoY per bucket with percent change.
- "Drivers" table: top increases and decreases by the selected dimension, so the planner sees what moved.
- Demand plan table: per product (or dimension member) — historical demand, baseline per period, planned total over the horizon, variability, and inventory implication.
- "Why this plan" panel: inputs (filters, period, source table, policy values used), method (formula in words), output, and limitations. Always present.

## 5. Inventory implications (consumes the existing engine)

The workspace joins its demand plan to the existing `buildRecommendationView` output by SKU and derives a planning signal from the engine's own classification plus the demand direction:

| Demand direction | Engine action | Planning signal |
| --- | --- | --- |
| Increasing | REORDER / WATCH | Replenishment pressure |
| Declining | EXCESS | Slow-moving / excess risk |
| Stable | HOLD | No intervention |

No new thresholds for Excess / Reorder / Low Stock — the engine's action and reason are displayed as-is. No purchase orders, no supply planning.

## 6. Inventory workspace upgrade

`inventory.tsx` keeps its current columns and behaviour and gains:

- the same shared filter bar (supplier, location/region/state, status, plus the existing search/category);
- sortable columns for on hand, on order, cover, value, unit cost, and — where data exists — selling price, revenue and margin, each showing "—" when the input is absent;
- the demand-direction column linking each SKU to its demand plan;
- reorder point and safety stock surfaced from the engine output already loaded.

No competing status definitions; `StatusBadge` and engine actions stay authoritative.

## 7. Planner controls

The Package 1 policy form is reused, not duplicated: the Demand Planning page shows a read-only "assumptions in effect" summary with a link to Settings, and the settings form is regrouped into "Active in demand planning" vs "Stored for future packages" so the distinction is explicit in one place.

## Technical notes

- New files: `src/lib/demand/{series,baseline,dimensions}.ts`, `src/components/planning-filters.tsx`, `src/components/demand-*.tsx` (chart, plan table, why-panel), `src/routes/_authenticated/demand-planning.tsx`.
- Changed: `src/lib/query/filters.ts` (channel/customer/compare), `src/lib/data/repository.ts` (`loadDemandFacts`), `src/lib/ionic.functions.ts` (`getDemandPlan` server fn, auth-middleware + Zod validated), `src/components/app-shell.tsx` (nav), `src/routes/_authenticated/inventory.tsx`, `src/components/planning-policy-form.tsx` (grouping), `src/routes/_authenticated/settings.tsx`.
- No database migration. No schema change. No new dependencies (recharts and zod are already present).
- Security unchanged: `getDemandPlan` uses `requireSupabaseAuth`, resolves the organisation server-side via `resolveOrg`, validates all input with Zod, and never accepts `org_id` from the client. RLS remains the enforcement boundary.
- Performance: the demand plan and the recommendation view are computed once per request and shared; the workspace does not call `buildRecommendationView` twice. The existing whole-workspace recompute is left in place and re-reported as a follow-up rather than redesigned here.
- Verification after implementation: typecheck, lint, production build; demand plan against the existing 12 months of demo data; recommendation output compared before/after (must be identical); filter and grain changes exercised; a second organisation checked for zero data leakage; empty-history and missing-dimension paths exercised deliberately.

## Out of scope (reported, not built)

Supply/Distribution/Scenario planning, PO inbox, plan vs actual, seasonality indices (needs ≥24 months), statistical safety stock from service level (Supply Planning), day-grain analytics at scale (needs real transaction volume), ingestion changes, pagination/caching redesign of the recommendation view.
