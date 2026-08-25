# Ionic — B2B Distributor Core Redesign

A surgical restructure of the existing app around one owner/operator of a B2B distribution business unit. Existing ingestion/ETL, canonical model, import lifecycle, provenance, inventory and replenishment math, time-phased projection, scenario engine, auth/RLS, filters and exports are preserved and extended — not replaced.

## What exists today (verified)

- Routes: `overview`, `inventory`, `recommendations`, `demand-planning`, `supply-planning`, `distribution`, `purchasing`, `scenarios`, `data-sources`, `settings`, `sku/$sku`.
- Engines: `lib/engine/inventory-engine.ts`, `lib/demand/*` (trailing-average baseline), `lib/supply/*` (netting, projection, explain), `lib/distribution/plan.ts`, `lib/scenario/*`.
- Data: single repository (`lib/data/repository.ts`, 1.8k lines) and one server-function module (`lib/ionic.functions.ts`, 28 functions), all org-scoped server-side.
- Demand today is exclusively history-derived; `demand_forecasts` rows are stored but not consumed. Cost is a single `unit_cost`. A PO has one `expected_at` and no shipment concept.

These three are the real conceptual mismatches for the ICP, and they drive the work below.

## Delivery in four packages

Each package ends with a building app, coherent navigation and passing tests. I will implement them in order, in this codebase.

### Package A — Commercial spine and Demand Book

New tables (org-scoped, RLS + GRANTs, same patterns as existing): `contacts`, `requirements`, `opportunities`, `quotations`, `customer_orders` (LPO, multi-period capable), `market_signals`, and `demand_signals` — the Demand Book.

A demand signal carries: customer, product, quantity/unit, expected period, channel (`direct_shipment` | `dropship` | `stock`), source (`history` | `requirement` | `opportunity` | `quotation` | `lpo` | `order` | `market` | `planner`), certainty (`speculative` → `expected` → `active` → `high_confidence` → `committed` → `confirmed` → `actual`), probability, status, evidence/notes, date, and a link to the commercial record it came from.

`customers` and `channels` already exist and are reused. Historical actuals are projected into the book as `history`-sourced signals rather than being a separate path.

**Resolution, not summation.** The book is a unified evidence layer. The resolver (`lib/demand/resolve.ts`) never adds overlapping signals: signals are grouped by the commercial event they describe (customer + product + period + originating record chain), and within a group the highest-certainty signal wins — an LPO supersedes its quotation, a quotation supersedes its opportunity, realised actuals supersede everything for a closed period. History informs the baseline for demand not otherwise claimed by a named commercial signal; opportunities count only as incremental demand above that baseline. Every superseding rule is documented in code and covered by unit tests, including deliberate double-count cases.

**Confidence stays a commercial judgement.** No black-box weighted forecast. Probability applies to uncertain opportunities only; certainty, source, evidence, status and date are preserved and shown. Each resolved demand row expands into the exact signals that produced it, which ones were superseded and why, so "why does Ionic expect this demand?" is answered from records rather than from an invented statistical reason.

**Market Signals** are deliberately lightweight: a small record of external/commercial context (competitor pricing or availability, supplier changes, market gaps, consumption changes, new product opportunities, supply disruption, regulatory conditions) that can be attached to a customer, product or supplier and referenced as evidence. They inform judgement and appear in the Control Tower; they do not silently alter numbers. No market-research platform.

Demand engine change: `lib/demand/` gains this resolver, and history becomes one input. **`buildDemandBaseline` remains the single history primitive** — no parallel demand engine; supply, distribution, recommendations, business plan and scenarios all read one resolved demand series.

UI: `Business` section — Customers, Contacts, Requirements, Opportunities, Quotations, Market Signals, Demand Book. Demand Book is the centre: filterable table with expandable rows showing the resolution trail, and an export.


### Package B — Landed economics and shipments

Schema: `supplier_products` (supplier price, currency, MOQ, lead time), `cost_components` per product/supplier/shipment (freight, duty, clearance, other, FX), and `shipments` with `shipment_lines` linked to `purchase_orders` — **one PO to many shipments**, with the lifecycle states listed in the brief and an ETA plus delay derivation.

A single landed-cost service (`lib/economics/landed-cost.ts`) computes supplier price → freight → duty → clearance → other → FX → landed cost → selling price → gross profit → margin. `unit_cost` stays as the fallback so nothing that reads it breaks; the engine prefers landed cost where components exist.

Supply projection consumes shipment ETAs instead of a single PO `expected_at`, keeping the existing netting/projection math.

UI: `Supply` section — Purchase Orders (existing inbox preserved), Shipments, Inbound, Import/Clearance. Procurement decisions gain a landed-economics panel answering "can I buy this and still make money?".

### Package C — Control Tower, inventory depth and Business Plan

`lib/control-tower/signals.ts` derives prioritised exceptions from real data only — shipment delay vs committed demand, cover vs next inbound ETA, quotation ageing, landed-cost movement vs quoted margin, demand shifts, slow-moving stock, unmatched supply for qualified demand, recorded market signals. Each item is typed urgent / warning / opportunity / informational / healthy, and each expands to its evidence and then to the underlying record. No fabricated signals; demo-derived items are labelled as demo.

Inventory gains committed vs free quantity (from committed demand signals), expected inbound, ageing/expiry where data exists, value, COGS and margin. Existing inventory calculations are extended, not duplicated.

The Control Tower becomes `/` for signed-in users; the old `overview` dashboard content is folded into it or retired.

**Business Plan** is a real workflow, not a nav label. One table `business_plans` plus `business_plan_lines` holds an annual revenue target and gross-profit target, broken down into contribution lines by supplier, product and customer with expected quantity, expected revenue, expected GP and margin. Two directions over the same lines:

- Bottom-up: lines are seeded from the resolved Demand Book and landed economics (quantity × selling price → revenue; minus landed cost → GP), then adjusted.
- Top-down: an annual target is allocated across suppliers/products/customers by share, then reconciled.

The plan screen always shows the reconciliation gap between the sum of contribution lines and the annual targets, per dimension. "What changes when assumptions change" reuses the **existing scenario engine** — a business plan can be evaluated under a scenario's assumptions through `executeScenario`; no second planning system, no duplicate demand or cost math. Export included.


### Package D — Navigation, visual redesign, exports, de-scoping

Navigation becomes: Control Tower · Business · Inventory · Planning · Supply · Data. Existing routes are kept and re-parented (with redirects from old paths) so no links break. Planning keeps Demand, Supply, Business Plan, Scenarios. Data Hub keeps its source health, grouping, expandable rows, record counts and exports.

Visual pass in `src/styles.css` tokens only: warm-white background, near-monochrome surface, deep sage primary, restrained semantic accents (sage healthy, orange attention, red risk, blue info, mustard watch), generous spacing, quiet tables, expandable rows, no gradients or heavy shadows. Component structure stays.

Exports: demand plan, supply plan, procurement plan, inventory health, scenario comparison, performance — reusing the existing export utility.

De-scoping: FMCG/retail-oriented framing (UPSPW-style forecasting, retail sell-through, retailer hierarchy as a demand dimension, distribution/allocation as a primary screen) leaves the primary UX. Underlying code stays until dependency-traced and verified dead; distribution planning moves under Planning as a secondary view rather than being deleted.

## Technical notes

- All new tables follow the existing pattern: `org_id`, composite `(org_id, id)` FKs, GRANTs in the same migration, `is_org_member` RLS.
- All reads/writes go through the existing repository and server-function modules; org identity stays server-derived.
- No new dependencies. No AI. No parallel engines or duplicate persistence.
- Demo dataset is extended to the distributor model (customers with requirements, opportunities, quotations, LPOs, multi-shipment POs, landed-cost components) rather than replaced.
- Verification each package: `tsgo` typecheck, existing unit tests plus new demand-book/landed-cost/shipment tests, and a Playwright walkthrough of every route.
