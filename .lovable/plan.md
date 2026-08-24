# Ionic — Product & Codebase Audit (read-only)

Evidence gathered from the live codebase: schema/migrations, `src/lib/domain`, `src/lib/ingestion`, `src/lib/{engine,demand,supply,distribution,scenario,analytics}`, `src/lib/data/repository.ts`, `src/lib/ionic.functions.ts`, and every route under `src/routes`. Nothing was modified.

## 1. Executive summary

**What Ionic currently is.** A multi-tenant replenishment-planning tool. It ingests spreadsheets into a canonical model, then answers one question well: *given historical sales, current stock, lead time and open POs, what should be reordered, how much, and by when.* Around that sit five read-only workspaces (Dashboard, Inventory, Demand Plan, Supply Plan, Distribution), a PO approval inbox, a scenario engine, and a genuinely strong intelligent-ETL layer.

**What it appears to have been designed to do.** Serve a mid-sized FMCG-style distributor with repeat sell-through demand, owned warehouse stock, one operating currency, and multiple users under org roles. Design signals: monthly sales aggregate as the engine's read path (`repository.ts` `refreshMonthlySales`), a single flat `products.unit_cost`, movement vocabulary of `sampling / promotional / expiry / quality_loss` (`domain/movement.ts`), trailing-average demand as the only implemented method, and multi-tenancy threaded through all 29 server functions.

**Biggest mismatch with the new ICP.** Ionic models **demand as history**. Distributor LTD's demand is largely **forward and commercial** — requirements, opportunities, probability, expected orders, LPOs, customer commitments. There is no representation anywhere of customer, contact, requirement, opportunity, quotation, deal, or LPO as a *pipeline object with certainty*: `customers` exists only as a reporting dimension on transactions. Second mismatch: the **money model**. Landed economics (freight, duty, clearance, FX) is the trader's core decision, and Ionic has no cost decomposition and no FX conversion — `currency_code`/`original_amount` are stored verbatim, never converted. Third: **channel is a chart filter, not a fulfilment mode** — direct-shipment, dropship and stock are planned identically, as if every SKU is replenished into owned inventory. Fourth: there is **no shipment object**; one PO cannot become multiple shipments (`supply/netting.ts` produces one lump order per SKU per horizon).

**Salvageable?** Yes, substantially. The ingestion layer, the canonical-model discipline, the provenance/import-batch lifecycle, the honesty conventions (never invent a number; block on missing lead time; disclose downgraded grain), the scenario dual-pass engine and the whole inventory/supply mathematics are ICP-neutral and worth keeping. What must change is *what feeds demand* and *what a plan costs* — plus new commercial objects. This is an extension plus a subtraction, not a rebuild.

## 2. Current architecture

**Data model.** ~22 tables, all `org_id`-scoped with RLS. Master: `products`, `suppliers`, `locations`, `customers`, `channels`. Facts: `inventory` (snapshot), `sales` (monthly rollup), `sales_transactions` (day grain, source of truth when present), `inventory_movements` (record-only), `demand_forecasts` (stored, never read by any engine), `purchase_orders`. Planning: `planning_policies` (one row/org), `recommendations`, `scenarios`, `scenario_runs`. Provenance: `import_batches`, `data_sources`, `audit_logs`. Tenancy: `organizations`, `memberships`, `profiles`.

**Backend.** TanStack Start server functions — 29 in `src/lib/ionic.functions.ts`, every one behind `requireSupabaseAuth`, every one resolving the tenant server-side via `resolveOrg()` before any query. RLS in Postgres is the enforcement boundary; app-level `org_id` filters and inline role checks are defence in depth. All DB access funnels through `src/lib/data/repository.ts`.

**Planning engine.** Pure functions, no React, no Supabase. `engine/inventory-engine.ts` (reorder decisions) → `supply/{plan,projection,netting}` (time-phased projection, net requirement, order-by date) → `distribution/plan.ts` (transfer suggestions) → `scenario/run.ts` (runs the whole chain twice for what-if). `demand/{series,baseline,dimensions,plan}` is a parallel demand pipeline.

**Ingestion.** Single upload (CSV/XLSX, ≤5MB). Sheets classified by *structure and values*, never sheet names: grain inference (`ingestion/grain.ts`), entity scoring against 12 entity kinds (`ingestion/mapping.ts`), cross-sheet relationship detection, per-sheet disposition (auto/review/blocked/unsupported/ignored), deterministic row validation, FNV-1a row fingerprints for re-import idempotency, and an active/inactive/deleted batch lifecycle that soft-excludes rows from planning.

**UI.** `AppShell` sidebar with 10 items → 10 routes plus `/sku/$sku` and `/scenarios/$scenarioId`. A shared `PlanningFilters` component and a shared `useProductLabel()` hook are reused across inventory/demand/supply/distribution.

## 3. Business object coverage

| Business object | Represented? | Where | Quality / problem | ICP fit |
| --- | --- | --- | --- | --- |
| Customer | Partial | `customers` table, dimension on `sales_transactions` | Reporting dimension only; no relationship, share, or commitment | Critical gap |
| Contact | No | — | — | Missing |
| Market / business activity | No | — | — | Missing |
| Requirement | No | — | — | Critical gap |
| Opportunity | No | — | No probability/certainty concept anywhere | Critical gap |
| Project / Deal | No | — | — | Missing |
| Quotation | No | — | No pricing/quote object; `unit_price` is a static product field | Critical gap |
| Customer order / LPO | No | — | Demand is only history; no order book | Critical gap |
| Product / SKU | Yes | `products` | Solid; planning params on the item | Good |
| Supplier | Yes | `suppliers` | Lead time, MOQ, reliability | Good |
| Supplier product | No | — | No supplier×product pricing/lead-time matrix | Gap (multi-source buying) |
| Supply agreement | No | — | — | Future |
| Purchase order | Yes | `purchase_orders` | Fulfilment + approval status kept separate (good); single expected date | Good, needs shipments |
| Shipment | No | — | One PO = one arrival; no consolidation/container | Critical gap |
| Import / clearance | No | — | No duty, freight, clearance, landed cost | Critical gap |
| Inventory / stock lot | Partial | `inventory` (product×location balance) | No batch/lot, no age, no expiry date, no shelf life | Partial |
| Planning inventory (committed/free/expected) | Partial | computed in `supply/projection.ts` | Ephemeral projection; no committed-vs-free split (no order book to commit against) | Partial |
| Inbound | Partial | open POs via `loadOpenSupply` | Only `status='placed'` with outstanding qty | Partial |
| Delivery | No | — | — | Gap |
| Actual sale | Partial | `sales_transactions` | Has customer/channel/location/value/COGS; no salesperson, no invoice/delivery-note link, no business unit | Partial |
| Demand | Partial | `demand/*` from history only | History-only, trailing average | Major reframe needed |
| Forecast | Stored, unused | `demand_forecasts` | Written by ingestion, read by nothing (`demand/baseline.ts` says so explicitly) | Dead input |
| Commercial / business plan | No | — | No revenue/GP target, no bottom-up plan build | Critical gap |
| Market signal | No | — | — | Missing |
| Actuals (vs plan) | No | — | Actuals exist; nothing to compare them to | Gap |
| Documents | No | — | — | Missing |
| Price / cost | Weak | `products.unit_cost`, `unit_price`, PO `unit_cost` | Flat single cost; no landed build-up; no FX conversion | Critical gap |
| Location | Yes | `locations` | Retrofitted from free text; good enough | Good |
| Business unit / entity | No | `organizations` is the only grouping | Org == tenant, not business unit | Gap |
| Sales channel | Partial | `channels` | Reporting dimension only, not a fulfilment mode | Reframe needed |
| Status / lifecycle | Partial | PO status/approval, import batch lifecycle | Good where it exists; no commercial lifecycle | Partial |
| History / audit | Yes | `audit_logs`, `import_batches`, `scenario_runs` | Strong | Keep |

## 4. Workflow coverage

| Distributor LTD stage | Current Ionic capability | Gap | ICP fit |
| --- | --- | --- | --- |
| Market intelligence | None | Entire stage | Future |
| Customer / lead development | None (customers are a dimension) | CRM-lite objects | Missing, MVP-relevant |
| Requirements | None | Requirement object | Critical |
| Opportunities | None | Opportunity + probability | Critical |
| Customer / commercial forecast | Trailing average of history only | Bottom-up customer×product forecast, capture share, confidence | Critical |
| Annual business plan | None | Target, plan build, plan-vs-pipeline | Critical |
| Selling / quotation | None | Quote object | Gap |
| Costing / landed economics | None | Freight/duty/clearance/FX, margin per deal | Critical |
| Procurement | Strong — reorder qty, order-by date, MOQ, supplier lead time | Multi-source choice, buy-for-customer vs buy-for-stock | Good base |
| Purchase order | PO inbox, approval, receipt tracking, re-import updates in place | Link to customer order; multi-shipment | Good base |
| Shipment | None (`expected_at` proxy) | Shipment object, milestones, ETA changes | Critical |
| Import / clearance | None | Clearance status, cost, documents | Critical |
| Inventory | Strong — position, cover, safety stock, excess, per-location | Ageing, expiry, committed vs free | Good base |
| Customer order | None | Order book | Critical |
| Delivery | None | Delivery/DN | Gap |
| Actual sale | Ingested at day grain with margin fields | Invoice/DN as truth source; salesperson | Partial |
| Performance / learning | Analytics + scenario comparison only | Win/loss, forecast accuracy, plan vs actual | Gap |
| Next forecast / plan | Recomputed trailing average | Learning loop | Gap |
| Control tower ("what needs attention") | Partially emergent (risk flags, PO inbox, excess) | No single prioritised action feed across shipments, customers, quotes, stock | High-value, near-reachable |

## 5. Planning engine audit

**What it calculates.**
- `avgMonthlyDemand` = mean of trailing `demandWindowMonths` (default 6) of `sales`; `avgDaily = /30.44`.
- `safetyStock = avgDaily × safetyStockDays`; `reorderPoint = avgDaily × leadTime + safetyStock`; `targetStock = avgDaily × (leadTime + 30-day review + safetyStockDays)`; `excessThreshold` adds 90 days.
- Action: no lead time → WATCH (blocked, qty 0); zero demand → EXCESS/HOLD; `netAvailable ≤ reorderPoint` → REORDER; excess units → EXCESS; within 1.25× RP → WATCH; else HOLD.
- Order qty = `targetStock − netAvailable`, rounded up to MOQ then order multiple.
- Supply plan: monthly projection `prev − plannedPerPeriod + receipts`, past-due receipts pulled into period 1 (disclosed), first stockout / first-below-safety, `netRequirement = targetStock − lowPoint`, `orderByDate = triggerPeriod − leadTime`, risk flags.
- Distribution: per-location cover from day-grain transactions only; greedy excess→need transfer legs; can only *reduce* the supply requirement.
- Scenario: same chain run twice (live vs transformed policy/signals/open supply); results persisted immutably in `scenario_runs`.

**Assumptions that are appropriate and ICP-neutral.** Reorder point / safety stock / target stock arithmetic; MOQ and order-multiple rounding; time-phased projection with open-supply netting; order-by-date; blocking on missing lead time; explicit "insufficient history → no baseline" rather than a fabricated number; comparison honesty (`changePct = null` when baseline is 0); multi-location aggregation with allocation openly flagged as unoptimised.

**Assumptions that are FMCG/manufacturing-shaped or ICP-hostile.**
1. Demand = historical sell-through, full stop. `demand_forecasts` is deliberately excluded (`demand/baseline.ts` comment). No opportunity/probability weighting exists.
2. Monthly-only projection grain hard-coded in `supply/projection.ts`, even where day-grain data exists.
3. Single flat `unit_cost` drives `estimatedCost`/`suggestedSpend` — no landed cost, no FX, no duty.
4. One lump order per SKU per horizon — no multi-shipment phasing, no container/consolidation.
5. Channel never affects policy: direct-shipment and dropship SKUs are planned as if stocked.
6. Continuous-replenishment model assumes reasonably repeating demand; lumpy project/bulk B2B orders will oscillate between REORDER and EXCESS.

**Unused / inert.** Policy fields stored, validated, editable in Settings and consumed by nothing: `serviceLevel`, `seasonalityEnabled`, `demandVariability`, `leadTimeVariabilityDays`, `reorderPointOverride`, `minimumStockLevel`, `targetStockLevel`, `daysOfCoverTarget`, `demandMethod` (single legal value). Dead constant `stockoutRiskCoverDays`. `demand_forecasts` and `inventory_movements` are written and never read by any engine. The `recommendations` table is effectively write-only — every page recomputes `evaluateAll` live; only run provenance is read back. Three independent demand computations exist (engine, supply baseline, distribution per-location) that can diverge.

## 6. Feature disposition

| Feature / module | Disposition | Reason |
| --- | --- | --- |
| Intelligent ETL (classify, grain, mapping, validate, canonicalise) | **Keep** | Best asset; structure-based classification generalises to distributor data |
| Import batch lifecycle + provenance + audit log | **Keep** | Trust foundation; ICP-neutral |
| Canonical domain model (`domain/*.ts`) | **Keep, extend** | Right architecture; needs commercial objects added |
| Inventory engine (RP/SS/target/MOQ) | **Keep** | Math is sound; must be fed better demand |
| Supply plan / projection / netting | **Refactor** | Keep the projection; add shipments, weekly grain, landed cost |
| Distribution plan (transfers) | **Future** | Correct but presumes multi-warehouse depth this ICP lacks initially |
| Scenario engine + immutable runs | **Keep** | Directly useful for FX/lead-time/cost shocks |
| Demand plan workspace (history, dimensions, baseline) | **Refactor** | Keep the series/dimension machinery; replace "demand = history" framing |
| `demand_forecasts` ingestion | **Refactor** | Ingested but unconsumed — should become the forward-demand path |
| `inventory_movements` | **Keep (dormant)** | Cheap to hold; not MVP-critical |
| Dashboard / Overview | **Replace** | Should become the control tower ("what needs my attention now") |
| Analytics (`/recommendations`) | **Refactor** | Duplicates decision tables shown on Inventory and Demand Plan |
| Inventory page | **Keep** | Directly relevant; add ageing/committed later |
| Procurement / PO inbox | **Keep** | Directly relevant; extend to shipments |
| Settings → planning policy form | **Refactor** | Exposes ~10 parameters that change nothing — misleading |
| Unused policy fields + dead constants | **Remove (later)** | Inert surface area |
| `recommendations` table as storage | **Refactor** | Write-only; either serve from it or drop it |
| Multi-tenancy (orgs, memberships, roles, RLS) | **Keep, hide** | Uniform and safe; collapse the *UX*, not the schema |
| Connector catalogue (Odoo/SAP/NetSuite placeholders) | **Future** | Declared, unimplemented |
| Marketing landing + auth | **Keep** | Works |

## 7. Architectural risks

- **`buildRecommendationView` / `evaluateAll` is load-bearing for 7 surfaces.** Any change to the demand input changes Dashboard, Inventory, Analytics, SKU detail, Supply, Distribution and Scenario numbers simultaneously. Redesigning demand without a regression harness is the single most dangerous move. (`src/lib/scenario/scenario.test.ts` and the supply tests are the existing safety net.)
- **No caching anywhere.** Every page load recomputes the entire portfolio from raw tables. Adding richer demand logic multiplies an already-unbounded cost.
- **Three divergent demand computations** — engine, supply baseline, distribution — must be reconciled before a new demand model is introduced, or the workspaces will quietly disagree.
- **`PlanningFilter` is a shared contract** across four pages and four server functions; changing its shape is a coordinated edit.
- **Role checks are copy-pasted inline** in 6+ server functions rather than a shared helper — any authorization change is a multi-site edit and an easy place to miss one.
- **`org_id` is everywhere** (128 references in the repository layer alone, `resolveOrg` in all 29 server functions). Removing multi-tenancy would be a mechanical but very wide change with real RLS risk. Keeping it is cheaper and safer than removing it.
- **Cost model is unstructured.** Retrofitting landed cost/FX later touches products, POs, recommendations, supply spend, scenarios and every currency-displaying UI. The longer this waits, the more expensive it gets.
- **Soft-delete semantics** (`import_batches.status = 'deleted'`, no DB DELETE policy) mean "deleted" data still exists and must stay filtered — easy to reintroduce as a leak in new queries.
- **`supabaseAdmin` (RLS-bypassing) exists**; its call sites were not fully traced — UNKNOWN, worth a targeted check before any tenancy change.

## 8. Recommended restructure (conceptual only)

Smallest coherent MVP for one operator running one B2B import/distribution business unit:

```text
        COMMERCIAL SIGNAL                   SUPPLY SIGNAL
  Customer ─ Requirement ─ Opportunity   Supplier ─ SupplierProduct
        │ (qty, price, probability,          │
        │  expected date, channel)           │
        ▼                                    ▼
     DEMAND BOOK  ◄── history (sales_transactions)
     (committed | expected | speculative)
        │
        ▼
     PLANNING CORE  (existing engine, unchanged math)
     demand → position → requirement → order-by-date
        │
        ├──► PROCUREMENT: PO ─► SHIPMENT(s) ─► CLEARANCE ─► INVENTORY
        │        with LANDED COST build-up (FOB + freight + duty + FX)
        │
        └──► CONTROL TOWER: one prioritised action feed
             (stock risk · shipment exception · customer waiting ·
              quote/order follow-up · ageing stock · plan vs actual)
```

Five concepts carry the MVP: **Demand Book** (one table where every demand line has a source, a quantity, a date and a certainty level — history, forecast, opportunity, LPO — replacing "demand = trailing average"); **Channel as fulfilment mode** (stock / dropship / direct-shipment, deciding whether a line consumes inventory at all); **Shipment** between PO and Inventory, so one PO can arrive in parts; **Landed cost** as a structured build-up rather than one number; **Control Tower** as the home screen. Everything else is the existing engine, unchanged.

Keep tenancy in the database; collapse it in the product — one workspace, no member management surface, no role selector.

## 9. What should not be in the initial MVP

Distribution/transfer planning (needs multi-warehouse depth this ICP lacks); statistical safety stock from service level and lead-time variability; seasonality indices (needs ≥24 months); inventory movements as a planning input; the ERP connector catalogue; org/member/role management UI; multi-business-unit hierarchy; the duplicated Analytics table; the inert planning-policy parameters; day-grain analytics at scale; assembly/BOM notions implied by the movement vocabulary; and any attempt to automate qualitative commercial judgement — capture share, relationship strength and win probability should be *entered and displayed*, never inferred.

## 10. Final verdict

**Can it be salvaged?** Yes. A full rebuild is not justified. The layers most expensive to build — intelligent ingestion, canonical model, provenance, tenancy/RLS, and the planning mathematics with its honesty conventions — are all sound and ICP-neutral. What is wrong is the *product model above them*, which is a smaller and better-bounded problem.

**Preserve.** Ingestion/ETL and import lifecycle; canonical domain types; repository access pattern; the inventory/supply engine math; scenario engine; audit and provenance; the design system, shell and shared filter components; multi-tenancy in the database.

**Simplify.** Multi-tenancy in the *UI* (one workspace, one user); Settings (show only parameters that actually change numbers); collapse Analytics into Inventory/Demand; unify the three demand computations into one; make the Dashboard a control tower.

**Remove (later, deliberately).** Inert policy fields and dead constants; write-only `recommendations` persistence or its recompute twin — not both; Distribution page from primary navigation; connector placeholders.

**Rebuild.** The demand model (from history-only to a certainty-graded demand book); the commercial layer (customer, requirement, opportunity, quotation, LPO); shipments and clearance between PO and inventory; the cost model (landed economics and FX); and the plan-vs-actual learning loop.

**Sequence risk note.** Reconcile the three demand computations and put a numeric regression harness around the engine *before* changing what feeds demand — that ordering is what keeps this a surgical restructure rather than an accidental rewrite.
