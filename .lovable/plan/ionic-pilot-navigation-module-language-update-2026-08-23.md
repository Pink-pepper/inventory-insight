# Ionic — Pilot Navigation & Module Language Update

A relabel-and-reorder pass only. All routes, URLs, engines, ingestion, schema, RLS, auth, and calculations stay exactly as they are. No route files are renamed; navigation labels and page titles change while every existing URL (`/overview`, `/recommendations`, `/purchasing`, …) keeps working with no redirects needed.

## Changes

### 1. Navigation (`src/components/app-shell.tsx`)

Replace the `NAV` array with this exact order (labels change, routes do not):

```text
1. Dashboard      → /overview
2. Inventory      → /inventory
3. Demand Plan    → /demand-planning
4. Supply Plan    → /supply-planning
5. Procurement    → /purchasing
6. Scenario       → /scenarios
7. Analytics      → /recommendations
8. Distribution   → /distribution
9. Data Sources   → /data-sources
10. Settings      → /settings
```

### 2. Page titles & head metadata (per route, text only)

- `overview.tsx`: AppShell title `Overview` → `Dashboard`; head title `Inventory health overview — Ionic` → `Dashboard — Ionic` (description wording preserved).
- `demand-planning.tsx`: `Demand planning` → `Demand Plan`; head title updated to match.
- `supply-planning.tsx`: `Supply planning` → `Supply Plan`; head title updated.
- `purchasing.tsx`: `Purchasing` → `Procurement`; head title updated.
- `scenarios.index.tsx`: `Scenario planning` → `Scenario`; head title updated.
- `recommendations.tsx`: AppShell title `Recommendations` → `Analytics`; header description reframed slightly toward exploration ("Explore demand, inventory and purchasing signals… — every figure still comes from the same recommendation engine"); head title `Purchasing recommendations — Ionic` → `Analytics — Ionic`. All table content, filters, explanations, recalculation, and the StatusBadge logic are untouched.
- `distribution.tsx`: `Distribution planning` → `Distribution`.

### 3. Cross-link text (no destination changes)

- `overview.tsx`: link text `View recommendations` → `View analytics` (still `to="/recommendations"`).
- `supply-planning.tsx`: link text `Purchasing` → `Procurement` (still `to="/purchasing"`).
- `data-sources.tsx`: `Open overview` → `Open dashboard`.
- `scenarios.$scenarioId.tsx`: `All scenarios` → `All scenario runs` (minor; may be left as-is — will keep as "All scenarios" if no title collision).

Internal names (`getRecommendations`, `getOverview`, domain types, `StatusBadge`, file names, DB) are NOT renamed.

## Deliberately not done

- No pivot/explore engine, no Optimizer, no Dashboard redesign, no product-selector redesign (per package spec — future packages).
- No URL/route migrations, no duplicate routes, no redirects (URLs unchanged, so backward compatibility is automatic).
- No changes to recommendation logic, planning engines, ingestion, auth, RLS, security headers, or server functions.

## Verification

1. Typecheck + build pass.
2. Browser check: sidebar shows the exact 10-item order; each item opens the correct existing screen; page headers show Dashboard / Demand Plan / Supply Plan / Procurement / Scenario / Analytics.
3. Analytics page still renders recommendation rows, Explain panels, action filters, and the Recalculate button works (recalculate smoke check via the button).
4. Existing `/recommendations` and `/overview` URLs load directly.
5. Existing unit tests (`etl.test.ts`, `scenario.test.ts`, `supply.test.ts`, `distribution.test.ts`) still pass.

## Final report

After implementation: Changed / Preserved / Verified / Not implemented / Issues, per the package spec.
