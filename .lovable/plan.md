# Package 1 — Planning & Data Foundation

Goal: turn Ionic's hard-coded planning assumptions into an organisation-scoped, configuration-driven foundation, and add only the data structures the future planning packages genuinely require. No new planning screens, no forecasting, no ingestion changes.

## 1. Organisation planning policies

New table `planning_policies`, one row per organisation, every parameter nullable so "not configured" is a real state rather than a silent default:

- Inventory: reorder point override, minimum stock level, target stock level, days-of-cover target, safety stock days, service level
- Demand: historical demand window (months), planning horizon (days), demand methodology, growth/decline %, seasonality flag, demand variability
- Supply: default supplier lead time, lead-time variability, default MOQ, order multiple
- Display: `product_display` = `sku` | `name` | `sku_name`

Security follows the existing pattern exactly: `GRANT` to `authenticated` and `service_role` only, RLS on, SELECT via `is_org_member(org_id)`, INSERT/UPDATE/DELETE via `has_org_role(org_id, ['owner','admin'])`. `org_id` is always derived server-side from membership, never accepted from the client.

## 2. Backward compatibility (non-negotiable)

`ENGINE_CONFIG` becomes `DEFAULT_ENGINE_CONFIG`. A new `resolveEngineConfig(policy | null)` merges only the fields an organisation has actually set on top of those defaults. Every engine function takes an optional config argument defaulting to the defaults object, so:

- organisation with no policy row -> numerically identical output to today
- organisation with a policy -> its parameters drive the same formulas

No formula, classification threshold or explanation wording changes. Policy values the current formulas do not consume yet (service level, variability, seasonality, horizon, growth) are stored and validated but explicitly not wired into maths in this package.

## 3. Configuration flow

```text
Organisation -> planning_policies row -> resolveEngineConfig() -> engine -> recommendation
```

The engine keeps zero imports from React, Supabase or route code. The repository loads the policy alongside signals and passes the resolved config into `evaluateAll`. Recommendation runs continue to use the existing run provenance fields.

## 4. Product identification preference

One reusable helper (`formatProductLabel(preference, sku, name)`) plus exposure of the preference through the existing workspace server function. SKU and name both remain stored. Existing screens keep their current appearance; only places already rendering "SKU — name" route through the helper. No navigation or layout changes.

## 5. Geography dimension

New org-scoped `locations` table: code, name, country, region, state/province — supporting Country > Region > State > Location, with Nigerian state-level planning possible later. `inventory` gains a nullable `location_id`; the existing `location` text column stays and remains the source of truth for current code. A backfill creates one `locations` row per distinct existing inventory location and links it. Nothing is renamed or dropped.

## 6. Time dimensions

Recommendation: no new fact table and no derived-period columns in this package. `sales.period_month` stays the monthly grain the MVP writes and reads. Week/quarter/year and arbitrary ranges are derived at query time. This package ships a shared `time-grain` utility (bucket a date to day/week/month/quarter/year, build comparison ranges for YoY/QoQ/MoM/WoW) that future services and any eventual day-grain fact table both consume. Moving to daily/customer/channel grain requires a real migration and is deliberately deferred to the demand-planning package, where a compatibility view can preserve the monthly read path.

## 7. Commercial metrics

Additive, nullable only: `products.unit_price` (selling price) and `sales.cogs`. Revenue already exists. Gross margin and margin % are derived, never stored. Nothing is fabricated — where price or COGS is absent, margin is reported as unavailable, consistent with how the engine already handles missing lead time.

## 8. Reusable filtering foundation

A shared, server-side filter specification (product/SKU, supplier, category, location, region/state, date range, grain) with a validated Zod schema and a single applier used by server functions. No UI filter work, no page-specific implementations.

## Technical notes

- Migration is additive only: one new table (`planning_policies`), one new dimension table (`locations`), nullable columns (`inventory.location_id`, `products.unit_price`, `sales.cogs`), plus a backfill of locations from existing inventory rows. Rollback = drop the new table/columns; existing queries never reference them.
- New/changed files: `src/lib/domain/planning-policy.ts` (types, defaults, resolver), `src/lib/engine/inventory-engine.ts` (config threaded through, defaults preserved), `src/lib/data/repository.ts` (load/save policy, pass config), `src/lib/ionic.functions.ts` (get/update policy server functions, owner/admin only, Zod-validated), `src/lib/query/filters.ts`, `src/lib/domain/time-grain.ts`, `src/lib/format.ts` (product label helper), `src/routes/_authenticated/settings.tsx` (planning policy + display preference form on the existing page).
- Security: no change to auth, CSRF, headers, middleware or existing RLS. The new tables inherit the established grant/policy pattern; writes are role-gated server-side, not in the browser.
- Verification after implementation: typecheck, production build, migration applied and linted, recommendation output compared before/after for an org with no policy (must be identical), CSV ingestion re-run, cross-tenant read/write attempt against `planning_policies` confirmed blocked.

## Out of this package

Demand/Supply/Distribution/Scenario UIs, PO inbox, Excel ingestion, forecasting, plan vs actual, customer/channel grain, FX and tariffs.

## Architectural observations (reported, not fixed)

- Should fix soon: `buildRecommendationView` recomputes the whole workspace on every page load; it will not scale past a few thousand SKUs and should move to server-side pagination in a later package.
- Future consideration: `resolveOrg` always picks the user's oldest membership, so multi-org users cannot switch workspaces.
- Safe to leave alone: monthly-only sales grain, until demand planning needs daily.