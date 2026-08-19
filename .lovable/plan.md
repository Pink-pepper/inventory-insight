# Ionic Planning Extension — Architecture Audit & Implementation Plan

Audit only. No application code, schema, RLS, auth, dependency or UI changes were made.

## 1. Current architecture assessment

**Tenancy & auth.** Every customer row carries `org_id`. `resolveOrg()` derives the workspace server-side from `memberships` (first membership by `created_at`) — client-supplied org IDs are never trusted. Auth is Supabase; protected pages live under `_authenticated/` with an `ssr: false` gate; server functions use `requireSupabaseAuth`. RLS uses `is_org_member()` / `has_org_role()` security-definer helpers, plus least-privilege table grants and composite `(org_id, id)` foreign keys that prevent cross-tenant references. This model extends cleanly to every new planning table.

**Data model.** `organizations, profiles, memberships, suppliers, products, inventory, sales, purchase_orders, data_sources, recommendations, audit_logs`. A canonical TypeScript model (`src/lib/domain/model.ts`) sits between connectors, the engine and the UI; the repository (`src/lib/data/repository.ts`) is the only place that speaks snake_case Supabase rows.

**Engine.** `src/lib/engine/inventory-engine.ts` is pure, UI-free rule-based logic with all tunables in a single `ENGINE_CONFIG` constant, and it already produces structured explanations, data-quality blocks and per-SKU metrics (ROP, safety stock, cover, excess, target stock).

**Where it does not yet support planning**

| Requirement | Gap |
|---|---|
| Planning policies / scenario assumptions | `ENGINE_CONFIG` is a compile-time constant. Nothing is per-organisation or per-run. |
| Demand grain | `sales` is monthly only (`period_month`), keyed by product. No day/week/quarter, no channel, region, state or customer dimension. |
| Distribution planning | `inventory.location` is free text with no location entity, region/state, or transfer concept. |
| Procurement | `purchase_orders` has one product per row and a single 4-value status; no PO number, received qty, currency, buyer, approval vs fulfilment split, ETA vs actual delivery. |
| Scenarios / Plan vs Actual | `recommendations` stores one live run (`run_id`) with no named, saved, comparable versions and no forecast/plan rows to compare actuals against. |
| Excel ingestion | Connector interface is generic, but the CSV connector is a single-sheet string parser and no `.xlsx` reader is installed. |
| Product identification | Both SKU and name are stored; display mode is hardcoded in UI. |
| Filtering | Inventory/Recommendations filter with a single in-memory text box over a full server payload — fine at 50 SKUs, not at planner scale. |

## 2. Reusable components (extend, do not recreate)

- `resolveOrg`, `audit`, `persistDataset`, `loadSignals` — reuse for every new entity.
- Canonical domain model + repository mapping boundary — add planning types alongside.
- `inventory-engine.ts` — becomes the *inventory* strategy inside a broader planning engine; parameterise `ENGINE_CONFIG` instead of forking it.
- `Connector<TInput>` interface + `CONNECTOR_CATALOGUE` — the Excel reader is a new connector emitting the same `CanonicalDataset`.
- `summarise()` analytics, `AppShell`/nav, `StatusBadge`, table + explain-row patterns, skeletons and empty states.
- `audit_logs` — extend with plan/scenario/PO events.

## 3. Required data-model changes (proposed)

**Planning foundation**
- `planning_policies` — one active row per org: horizon, history window, demand method, service level, growth, seasonality mode, default safety-stock/target cover, review period, order-multiple and MOQ policy, product display mode (`sku | name | sku_name`), base currency.
- `planning_scenarios` — named, versioned; `assumptions jsonb` overriding the policy; status draft/saved/baseline.
- `plan_runs` — execution of a scenario: inputs snapshot, timings, counts, `created_by`.
- `plan_results` — per SKU × location × period output (demand, supply, projected on-hand, recommended order, cost) linked to `plan_run_id`.

**Data foundation**
- `locations` (code, name, type, region, state, country) and `inventory.location_id`; keep the text column during transition.
- `channels`, optional `customers`.
- `demand_history` / re-grained `sales` — add `period_start`, `grain`, `channel_id`, `location_id`, `customer_id`, value and cost columns. Safest path: a new fact table plus a compatibility view feeding the existing engine.
- `inventory` — add `allocated`, `available`, `stock_as_of`/age, `selling_price` on products, plus cost/price history if margin planning is required.

**Distribution**
- `transfer_recommendations` (from/to location, SKU, qty, rationale, saving) produced by a rebalancing pass that runs *before* external procurement.

**Procurement**
- Extend `purchase_orders` with `po_number`, `po_date`, `approval_status` (separate enum from fulfilment `status`), `currency`, `fx_rate`, `requested_delivery_date`, `eta`, `actual_delivery_date`, `receiving_location_id`, `buyer_id`, `source_plan_run_id`; add `purchase_order_lines` for multi-line POs with `qty_ordered` / `qty_received` / outstanding.

**Plan vs Actual**
- `plan_actual_snapshots` or a view joining `plan_results` to realised demand/supply/inventory/revenue by period, with variance columns.

Every new table needs `org_id`, RLS via `is_org_member` / `has_org_role`, and explicit GRANTs in the same migration.

## 4. Dependency map

```text
Planning policies ──► Scenarios ──► Plan runs ──► Plan results
        │                                  │
        ▼                                  ▼
Parameterised engine              Plan vs Actual  ──► Intelligence
        ▲                                  ▲
Locations/channels/time-grain facts ───────┘
        │
        ├──► Demand planning ──► Supply planning ──► Distribution planning
        │                              │
        └──► Excel/CSV ingestion       └──► PO inbox (linkage back to plan runs)
```
Nothing meaningful can be built before (a) parameterised assumptions and (b) the finer-grained demand/location facts. Scenario compare depends on plan runs; Plan vs Actual depends on both plan results and actuals; intelligence depends on everything.

## 5. Recommended implementation sequence

The proposed order is broadly right, with one change: **swap packages 1 and 2 partially** — the data foundation (locations, time grain, channels) must land alongside the planning foundation, because demand planning is unbuildable without it and retrofitting grain later would rewrite the engine twice.

1. **P1 Planning foundation** — `planning_policies` table + settings UI; make `ENGINE_CONFIG` a resolved runtime object (policy → scenario override → default). No behaviour change when a policy is absent.
2. **P2 Data foundation** — `locations`, `channels`, grain-aware demand facts, compatibility view, product display mode, extended inventory fields. CSV connector maps the new optional columns; existing files keep working.
3. **P3 Excel ingestion** — `.xlsx` multi-sheet connector emitting the same `CanonicalDataset`, with sheet→entity mapping UI. Requires one new parsing dependency.
4. **P4 Planning workspaces** — Demand planning (grain, comparisons, dimensions) then Supply planning (constraints, ETA, MOQ, multiples, FX/tariffs), plus planner-grade server-side filtering/sorting/pagination on Inventory.
5. **P5 Scenario planning** — scenarios, runs, saved versions, side-by-side compare and assumption-delta view.
6. **P6 Distribution planning** — rebalancing pass ahead of external procurement recommendations.
7. **P7 Procurement / PO inbox** — extended PO schema, lines, approval vs fulfilment status, plan linkage.
8. **P8 Plan vs Actual** then **P9 Intelligence layer** — detection rules over the variance/signal history, quantified impact and suggested scenarios.

## 6. Security considerations

Same posture, extended: `org_id` + RLS + explicit GRANTs on every new table; policies, scenarios, plan runs and POs are org-scoped; write-sensitive actions (editing planning policy, approving a PO, deleting a scenario) gate on `has_org_role(owner/admin)`, mirroring the existing delete policy. Scenario `assumptions jsonb` must be validated with Zod server-side and bounded — it is planner input, not free execution. Excel upload needs the same file-type/size limits, formula-injection neutralisation and sanitisation the CSV path already has, plus a per-sheet row cap, and must be parsed inside a server function (never trust client-parsed workbooks). Plan runs must record `created_by` and emit audit events. Approval workflow implies a real per-user permission model — today membership roles exist but no per-action grants.

## 7. Migration / backward compatibility risks

- Re-graining `sales` is the highest-risk change; mitigate with an additive fact table + view so `loadSignals` and the engine keep working unchanged.
- `inventory.location` → `location_id` must be additive with a backfill, not a rename.
- Making engine config dynamic must default to today's constants so existing recommendations are byte-identical when no policy exists.
- PO status split must preserve the current `po_status` enum values.
- Serving planner-scale data through the existing "fetch everything, filter client-side" pattern will degrade; server-side filtering must arrive with P4.

## 8. Risks, unknowns, and out-of-scope items

**Needs a product/engineering decision before implementation**
1. Forecasting method: rule-based moving average + seasonality index only, or statistical models (Holt-Winters/Croston)? Advanced forecasting was explicitly excluded from the MVP.
2. Nigeria state/region hierarchy: fixed reference list or org-configurable?
3. Multi-currency: store transaction currency + FX rate table, or single base currency with converted-at-ingest values?
4. Tariffs and supplier price changes: modelled as landed-cost rules, or simple scenario percentage adders?
5. PO approval: single approver, or roles/thresholds (implies a permissions model beyond owner/admin/member)?
6. Whether POs are authored in Ionic or only mirrored from the ERP.
7. Plan storage volume — SKU × location × period × scenario grows fast; needs a retention/aggregation policy.

**Outside current scope/capability**
- `.xlsx` parsing needs a new dependency; it must be a pure-JS, edge-compatible reader because the server runtime is a Cloudflare Worker (no native binaries, no `child_process`). Large workbooks may exceed request/memory limits — very large files would need chunked upload to storage plus background processing, which the current synchronous server-function model does not provide.
- Real ERP connectors (Odoo/SAP/Dynamics/NetSuite) remain out of scope; they need per-vendor credentials, OAuth and scheduled sync infrastructure.
- Live FX and tariff data require an external paid API and a scheduled job.
- Long-running plan runs across large catalogues may exceed serverless execution limits; a queue/batching approach would be needed.

## 9. Architecture Audit Status

- **Status:** Complete
- **Repository inspected:** Yes
- **Implemented:** No — audit only
- **Current architecture:** Multi-tenant Supabase app with RLS-enforced org isolation, a canonical domain model, a repository boundary, a pure rule-based inventory engine and a five-page authenticated UI.
- **Key reusable components:** `resolveOrg`/`audit`/`persistDataset`/`loadSignals`, the canonical model, the connector interface, the inventory engine, `summarise()`, and the AppShell/table/status UI patterns.
- **Key gaps:** No per-org planning policies or scenarios, monthly-only demand with no channel/region/location dimensions, no location entity or transfers, thin PO model, no plan-vs-actual store, no Excel reader.
- **Database/schema implications:** ~10 new tables plus additive columns; all additive, all org-scoped, with a compatibility view protecting the existing engine.
- **Security implications:** No change to the validated posture; new tables inherit RLS + GRANTs, scenario JSON needs strict server-side validation, Excel uploads need the CSV-grade hardening, approvals imply a richer permission model.
- **Recommended sequence:** Planning foundation + data foundation together, then Excel ingestion, planning workspaces, scenarios, distribution, procurement, plan-vs-actual, intelligence.
- **Outside scope / limitations:** Edge-runtime Excel parsing limits, no background job runner, no ERP connectors, no FX/tariff data source.
- **Critical decisions required:** Forecast methodology, currency handling, tariff modelling, PO approval permissions, PO authorship, region hierarchy, plan-data retention.
- **Recommended next step:** Answer decisions 1, 3 and 5, then implement Package 1 (planning policies + parameterised engine) as a strictly additive, behaviour-preserving change.
