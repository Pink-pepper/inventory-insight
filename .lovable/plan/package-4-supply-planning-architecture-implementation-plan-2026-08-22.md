# Package 4 — Supply Planning: Architecture & Implementation Plan

## 1. Current architecture assessment

Verified against the codebase and the live database on 2026-08-22.

### What exists that Supply Planning reuses

**Demand (Package 3)**

- `getDemandPlan` server fn (`src/lib/ionic.functions.ts`): auth + Zod + server-side org resolution; returns plan, planning rows, filter options, policy, last run.
- `src/lib/demand/series.ts` — facts → buckets at a grain with coverage descriptor and honest downgrade. Day/week only from `sales_transactions`; monthly from `sales`.
- `src/lib/demand/baseline.ts` — trailing average over `demandWindowMonths`, growth-adjusted by `demandGrowthPct`, projected over `planningHorizonDays`; carries assumptions, limitations, sufficiency flag, and variability (CV with labelled thresholds).
- `src/lib/demand/plan.ts` — composition: filter → series → baseline → dimension breakdown; per-SKU demand direction.
- `src/lib/domain/time-grain.ts` — bucketStart/bucketEnd/shiftRange for day→year. Reused as-is for planning periods; no duplicate grain logic.

**Inventory engine (authoritative, unchanged)**

- `src/lib/engine/inventory-engine.ts` — per SKU: avgDailyDemand, daysOfCover, safetyStock, reorderPoint, targetStock, excessUnits, classification (REORDER/WATCH/HOLD/EXCESS), MOQ rounding (`applyMoq`), data-quality issues (missing lead time is blocking), structured explanation. Config resolved via `resolveEngineConfig(policy)`.
- `buildRecommendationView` / `loadSignals` (`src/lib/data/repository.ts`) — products joined to suppliers; lead time resolution product → supplier → policy default with `leadTimeSource` provenance; aggregate on-hand/on-order across per-location positions; earliest ETA from placed POs.

**Policies (Package 1)** — `planning_policies` table, `PlanningPolicy` type split into consumed vs stored-only parameters.

**Ingestion (Package 2)** — CSV/XLSX → SheetTable → entity/column mapping → canonical model → idempotent persist with `import_batches` provenance. Entity kinds today: combined, products, suppliers, inventory, sales_monthly, transactions, customers, channels.

**UI** — `AppShell` nav, shared `PlanningFilters` bar, panels/tables/badges, recharts, `StatusBadge`, `useProductLabel`, settings policy form grouped "active vs stored".

### Data state that constrains Package 4 (verified, not assumed)

- `purchase_orders`: **0 rows**. The table exists (single product per row, `quantity`, `unit_cost`, `status` draft/placed/received/cancelled, `expected_at`) but nothing writes to it — no ingestion path, no UI.
- Open supply exists only as the aggregate `inventory.on_order` (15 rows > 0 in demo data) with **no ETA stored on inventory** (`CanonicalInventory.expectedAt` exists in the domain model but is never persisted).
- `locations`: 3 rows; country/region/state unused.
- `sales_transactions`: 0 rows after the test cleanup — day grain currently unavailable; monthly `sales` (1,800 rows, 12 months) is the demand source.
- 5 of 50 products have no lead time (already surfaced as blocking data-quality issues); 2 have no MOQ.
- Currency: column exists on `sales_transactions`, zero populated values. No currency on products/suppliers/POs.

## 2. Demand → Supply dependency map

```text
sales / sales_transactions            inventory rows            purchase_orders (empty today)
        │                                    │                          │
        ▼                                    ▼                          ▼
 loadDemandFacts (repo)            loadSignals positions      NEW loadOpenSupply (repo)
        │                              (on hand / on order /        (outstanding qty,
        ▼                               per-location)                ETA when present)
 per-SKU demand facts                     │                          │
        │                                 │                          │
        ▼                                 ▼                          ▼
 buildSeries + computeBaseline      engine evaluateAll        receipts by period
 (per SKU, grain = month)           (action, ROP, safety,            │
        │                            target — read only)             │
        └──────────────┬────────────────┴────────────────────────────┘
                       ▼
              src/lib/supply/* (new, pure)
        position → projection → netting → recommendation
                       │
                       ▼
              getSupplyPlan (server fn)  →  /supply-planning route
```

Package 4 consumes Package 3's building blocks (`bucketise`, `computeBaseline`, time-grain) per SKU — it does **not** re-implement demand maths, and it never modifies engine classifications.

## 3. Data availability matrix


| Input                 | Exists?     | Current source                                          | Sufficient?                                                                      | Package 4 change                                                         |
| --------------------- | ----------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Demand plan           | Yes         | Package 3 baseline per SKU                              | Yes, at month grain                                                              | None — reuse                                                             |
| On-hand inventory     | Yes         | `inventory.on_hand` (per location, aggregated)          | Yes                                                                              | None                                                                     |
| Allocated inventory   | **No**      | —                                                       | No                                                                               | Not added; report "available = on hand, no allocation data"              |
| On-order inventory    | Partial     | `inventory.on_order` aggregate                          | Partial: quantity yes, schedule no                                               | Treated as unscheduled supply unless a PO ETA exists                     |
| Safety stock          | Yes         | engine: `avgDaily × safetyStockDays` (product → policy) | Yes                                                                              | None                                                                     |
| Target stock          | Yes         | engine: lead time + review period + safety              | Yes                                                                              | None (policy overrides stay stored-only)                                 |
| Supplier              | Yes         | `products.supplier_id` → `suppliers`                    | Partial: single supplier per product; no supplier SKU refs, status, or locations | None (limitation stated)                                                 |
| Lead time             | Yes         | product → supplier → policy, with provenance            | Mostly: 5 products missing (already blocking)                                    | None; missing lead time blocks timing, never invents one                 |
| Lead-time variability | Field only  | policy `leadTimeVariabilityDays` (stored-only)          | No observed data                                                                 | Not activated; risk shown from engine stockout flag instead              |
| MOQ                   | Yes         | product → supplier → policy                             | Yes (2 products fall back)                                                       | Reuse `applyMoq`                                                         |
| Order multiple        | Yes         | policy `orderMultiple`                                  | Yes                                                                              | Reuse `applyMoq`                                                         |
| Unit cost             | Yes         | `products.unit_cost`; `purchase_orders.unit_cost`       | Yes for demo data                                                                | None                                                                     |
| Currency              | Column only | `sales_transactions.currency_code` (unpopulated)        | No                                                                               | Report single-currency assumption; no FX, no conversion                  |
| ETA                   | Schema only | `purchase_orders.expected_at`; **0 PO rows**            | No                                                                               | Minimal PO ingestion (below); ETA absent → "unscheduled"                 |
| Delivery delay        | No          | no actual/receipt dates anywhere                        | No                                                                               | Additive `received_quantity`/`ordered_at` only; delay analytics deferred |
| PO status             | Yes (enum)  | `purchase_orders.status`                                | Schema yes, data no                                                              | Same ingestion path                                                      |
| Production constraint | No          | —                                                       | No                                                                               | Out of scope, reported                                                   |
| Tariff                | No          | —                                                       | No                                                                               | Later package (with landed cost)                                         |
| FX                    | No          | —                                                       | No                                                                               | Later package; never invented                                            |


## 4. Proposed data-model changes (minimum additive)

One migration, additive only:

1. `purchase_orders` gains `received_quantity numeric not null default 0` and `ordered_at date` (nullable). Outstanding = `quantity − received_quantity`. This makes open / partially received / received / cancelled representable without a lines table or workflow.
2. Ingestion gains a `purchase_orders` entity kind (supplier code, SKU, quantity, unit cost, expected date, ordered date, status, optional received qty) reusing the existing inspect → map → commit wizard, with the same row limits and validation. This is the only way real open supply enters the system today.
3. Nothing else: no new tables, no supplier-product table, no transfers, no receipts ledger. Existing GRANT/RLS pattern on `purchase_orders` is already in place and unchanged.

If the PO ingestion slice is judged too large for this package, the fallback is option C from the brief: compute against `inventory.on_order` only, with every projection labelled "open supply is an unscheduled aggregate — import purchase orders for ETA-phased receipts." The recommended option is B (minimal foundation), because without it every supply plan is structurally unable to answer "when does supply arrive".

## 5. Supply Planning calculation design

New pure module `src/lib/supply/` (no React, no Supabase — same discipline as `src/lib/demand/`):

- `position.ts` — per SKU: on hand, on order (scheduled vs unscheduled), planned demand per period (from `computeBaseline` on that SKU's facts), safety stock / reorder point / target from the engine's metrics.
- `projection.ts` — time-phased projection at month grain (week only where transactions exist): walking forward from today, each period `projected = previous − plannedDemand + scheduledReceipts`. Outputs per period: projected on hand, first period below safety stock, first period below zero (projected stockout). Unscheduled on-order is shown separately and never silently booked into a period.
- `netting.ts` — net requirement = `max(0, targetStock − lowestProjectedPosition)`; The target stock used by Supply Planning must come from the existing authoritative inventory-engine calculation and must not independently resolve or activate the currently stored-only targetStockLevel, daysOfCoverTarget, minimumStockLevel or reorderPointOverride policy fields.
  Supply Planning must use the same target-stock definition as the existing engine so that Demand Planning, Inventory and Supply Planning do not produce competing definitions of the required stock position. Replenishment timing = first deficit period minus lead time (order-by date); suggested quantity = `applyMoq(netRequirement, moq, orderMultiple)` — reusing the engine's helper, not a copy. No lead time → no timing and no quantity: the row is flagged "Supplier lead time unavailable", consistent with the engine's blocking rule.
- `risk.ts` — supply risk flags derived only from real inputs: projected stockout before earliest receipt; lead time missing; ETA unknown for open supply; engine action EXCESS (procurement suppressed); MOQ forces over-order above target (quantity shown with the adjustment stated).
- `explain.ts` — per-row structured explanation: inputs (demand plan, position, open supply, policy values used), method in words, output, limitations. Mirrors the engine's `Explanation` pattern.

**Concept separation (per the brief):** demand requirement, inventory position, existing supply, net requirement, and suggested replenishment are five distinct fields in the output row — never collapsed into one number. "Suggested replenishment" is explicitly not a purchase order: no PO is created, no approval flow exists.

**Scenario readiness:** the pipeline is one pure function `buildSupplyPlan({facts, positions, supply, policy, overrides?})` with `overrides` defaulting to empty. Scenario Planning later supplies overrides (growth, lead time, MOQ) without restructuring. No scenario versioning now.

**Engine signal interaction:** the engine action is displayed as-is alongside the supply plan. Combinations are honoured rather than assumed: Engine classifications remain authoritative for the current inventory state, but Supply Planning must evaluate the forward projection separately. An EXCESS classification may suppress immediate replenishment where projected inventory remains sufficient, but it must not permanently suppress future supply requirements if the time-phased projection later falls below the required stock position. Similarly, REORDER does not automatically create a supply requirement if scheduled receipts already satisfy the projected requirement; REORDER + adequate scheduled receipts produces "no action — supply already inbound"; low stock never auto-purchases without net requirement after receipts.

**Procurement avoidance (Package 4 scope):** informational only. Where a SKU is held at multiple locations, the per-location positions already loaded are compared: a location whose standalone cover exceeds the excess threshold while the aggregate plan shows a net requirement is flagged "possible redistribution — review locations before purchasing". No transfer orders, no optimisation; the flag is the documented hook Distribution Planning will consume.

## 6. Policy parameters — Package 4 classification


| Parameter                                                                            | Classification                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demandWindowMonths`, `planningHorizonDays`, `demandGrowthPct`                       | Already active (demand baseline)                                                                                                                                                              |
| `safetyStockDays`, `defaultLeadTimeDays`, `defaultMinOrderQty`, `orderMultiple`      | Already active (engine) — reused, not re-read                                                                                                                                                 |
| `daysOfCoverTarget`, `targetStockLevel`, `minimumStockLevel`, `reorderPointOverride` | **Stay stored-only.** Activating overrides would create a second, competing target/ROP definition against the engine's computed values. Flagged as a product decision, not silently activated |
| `serviceLevel`, `leadTimeVariabilityDays`, `demandVariability`                       | Later package — require observed variability/receipts data that does not exist; no statistical safety stock in Package 4                                                                      |
| `seasonalityEnabled`                                                                 | Later package — needs ≥24 months of history                                                                                                                                                   |


No new policy fields, no duplicated storage. Settings grouping updated so the active/stored split reflects the above.

## 7. UI architecture

One new nav item, "Supply Planning", between Demand Planning and Inventory. No visual redesign.

Route `src/routes/_authenticated/supply-planning.tsx` reusing `AppShell`, `PlanningFilters`, panels, `StatusBadge`, `useProductLabel`, recharts:

- Shared filter bar (search, category, supplier, location; date range and grain where meaningful). Unavailable dimensions stay disabled with reasons, as today.
- Summary strip: SKUs with a net requirement; total suggested procurement value, only where a consistent currency is available; otherwise show "Not available" and the reason; Never aggregate monetary values across currencies without an explicit conversion method. No FX conversion is performed in Package 4; SKUs with projected stockout inside the horizon; rows blocked by missing data.
- Supply plan table (per SKU): on hand; on order (scheduled ETA / unscheduled); planned demand per period; projected low point and first stockout period; net requirement; suggested quantity after MOQ/multiple with the adjustment stated; order-by date; supplier and lead time with provenance; engine action badge; risk flags; procurement-avoidance hint.
- Per-SKU detail (expand or drill to existing SKU page): projected inventory line with safety-stock and reorder-point reference lines and scheduled receipt markers.
- "Why this supply plan" panel: inputs, method in words, outputs, limitations — always present, same pattern as Demand Planning.
- Every missing-data state renders as an explicit notice ("Supplier lead time unavailable", "No open purchase orders — on-order quantities are unscheduled"), never as a silent zero.

## 8. Server & security architecture

- `getSupplyPlan` server fn: `requireSupabaseAuth` middleware, Zod-validated input (reuses `planningFilterSchema`), organisation resolved server-side via `resolveOrg` — `org_id` is never accepted from the client. RLS remains the enforcement boundary; the new migration's GRANT/RLS on altered tables is unchanged (additive columns only).
- New repository loader `loadOpenSupply(supabase, orgId)`: open POs (`status = placed` and outstanding > 0) with product/supplier join. All queries org-scoped.
- The calculation runs in memory per request; nothing is persisted (no new write surface, no new audit events beyond existing patterns).
- CSRF, security headers, input limits: untouched. PO ingestion reuses the existing 5 MB / 50k-row / 20k-SKU limits and two-step validation.

## 9. Backward compatibility

- Engine untouched: recommendation output before/after must be byte-identical (verified in testing).
- Demand Planning and Inventory workspaces unchanged except the nav item.
- Migration is additive (two nullable/defaulted columns) — existing rows unaffected; `persistDataset` and the combined-CSV path keep working.
- `clearWorkspaceData` extended to include the PO ingestion path consistently.

## 10. Performance considerations

Current cost profile: `buildRecommendationView` recomputes the whole workspace per request (already flagged in Package 3 as a follow-up, not redesigned). Package 4 adds per-SKU baselines: 50 SKUs × (filter + bucketise + trailing average) — trivial arithmetic, no extra queries beyond one open-PO read. No bottleneck introduced. The known whole-workspace recompute stays a reported follow-up; if Supply Planning adoption makes it hurt, the smallest fix is a per-request shared load of signals+facts across the two server fns, or a short-lived cache — deferred deliberately.

## 11. Risks / unknowns

1. **No PO data exists today.** Until a user imports purchase orders, the supply plan's receipt phasing is empty and `on_order` is unscheduled. The UI must say this plainly; the value of the package still stands on net requirement and order-by timing from the demand plan. The purchase-order ingestion added in Package 4 is a data-ingestion foundation only. It does not create a PO management workflow, approval workflow, editing interface, receiving workflow or procurement execution capability.
  Imported POs are treated as external source data consumed by Supply Planning.
2. **On-order without ETA** is structurally ambiguous (ordered yesterday vs arriving tomorrow). Package 4 reports it as unscheduled rather than guessing; whether to optionally phase it at "today + lead time" *labelled as an estimate* is a product decision left open.
3. **Target/ROP policy overrides** (stored-only today) will eventually need a ruling: engine-computed vs planner-override precedence.
4. **Single supplier per product** constrains sourcing decisions; a supplier-product table is a later architectural step.
5. **Allocated stock** does not exist; available-to-promise is out of scope.
6. **Month grain only** for projections until real transaction volume exists (day grain would be noise today).

## 12. Implementation sequence

1. Migration: `purchase_orders.received_quantity` + `ordered_at` (additive, GRANT/RLS unchanged).
2. Ingestion: `purchase_orders` entity kind + canonical mapping + persist with dedup and batch provenance.
3. `src/lib/supply/` pure modules (position, projection, netting, risk, explain) + unit tests against fixtures including missing lead time, MOQ over-order, and unscheduled supply.
4. Repository: `loadOpenSupply`; `getSupplyPlan` server fn.
5. Supply Planning route + nav + components.
6. Settings regrouping copy update.
7. Verification: typecheck, lint, production build; recommendation output diff before/after (must be identical); empty-PO and missing-lead-time paths exercised; second-org isolation check; Playwright pass on the new workspace.

## 13. Explicitly outside current capability / deferred

- **Live FX and tariff feeds** — external services; belong to a landed-cost package. Cost implication: an FX data provider subscription if ever wanted; none now.
- **Historical supplier performance** (measured lead-time variability, fill rate) — requires receipt history that no source provides yet; the schema hook (`ordered_at`, `received_quantity`) is added so it can be computed later.
- **PO creation/approval, PO Inbox, transfers, scenarios, plan-vs-actual** — later packages by design.
- **Allocated inventory** — requires an allocation source none of the current connectors provide; reported as a limitation, not simulated.
- Nothing identified requires capabilities outside the current TanStack/Supabase stack or weakens any security control.