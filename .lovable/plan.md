# Ionic — Generalized Intelligent ETL & Planning Data Ingestion

## Context

The intelligent ETL layer (profile → classify → relationships → exception-based wizard) exists and works for the current entity set. The Cloud Ltd workbook exposed the boundaries of that design. This plan generalizes the semantic engine — grain, time orientation, scope, domain, policy detection — without hardcoding any workbook, without a second pipeline, and without weakening security or the import lifecycle.

Decisions already made:
- Forward-looking demand is persisted in a **new canonical forecast domain** (new table, provenance, batch lifecycle), distinct from Scenario Planning.
- Inventory consumption/movements are **classified and surfaced only** — no writes until a proper movement domain exists.
- The real `cloud_ltd_demo_dataset.xlsx` is **not currently attached**; a structural regression fixture is built from its described shape, and you re-attach the real file for final acceptance.

## Phase 1 — Current weaknesses (confirmed by inspection)

1. **No forecast domain**: `EntityKind` has no forward-demand kind. `canonicalise` rejects future-dated months as "excluded from demand history", so a forecast sheet misclassifies as monthly sales or breaks on import.
2. **No grain inference**: classification keys off required columns only. SKU+Date+Quantity is always "sales transactions" — consumption and movements misclassify.
3. **No time-orientation signal**: historical vs current-state vs forward-looking is never distinguished.
4. **No planning-policy detection**: parameter/value-shaped sheets fall to ignored/blocked; no connection to the existing `planning_policies` system.
5. **No scope detection**: org-level vs SKU/supplier/location-level parameters are not distinguished.
6. **Documentation sheets** get a generic "ignored" verdict and are never used as contextual evidence.
7. **Unsupported-but-useful data** is reported as "no columns matched" instead of being surfaced.
8. **Range/qualitative values** ("14–45 days", "±5–15%", "Moderate") would parse malformed or be silently collapsed.

## Phase 2 — Generalized semantic engine

Extend `src/lib/ingestion/` — same pipeline, deeper signals.

**New `grain.ts` — dataset grain inference**
- Test candidate key combinations (sku; sku+location; sku+date; sku+month; po_ref+sku; parameter-list) for uniqueness/duplication using profile cardinality.
- Grain output: `master | transaction | monthly_aggregate | snapshot | movement | forecast | policy | freeform`, with evidence. Grain becomes a first-class classification signal: the same SKU+date+qty fields resolve to transactions vs movement vs forecast based on grain + value patterns + orientation.

**`profile.ts` extensions**
- Detect percentage values, currency-prefixed numbers, **range tokens** (`14–45`, `±5–15`, `4–8x`, `10–35%`), qualitative tokens (Low/Moderate/High), and month-period values distinct from day-dates.

**`mapping.ts` extensions**
- New canonical fields: `forecast_period`, `baseline_qty`, `low_qty`, `high_qty`, `forecast_method`, `movement_qty`, `movement_type`, `parameter`, `param_value`, `param_unit`, scope columns (`applies_to_sku/supplier/location`).
- New entity kinds: `demand_forecast`, `planning_policy`, `inventory_movement` (surface-only), `documentation`.
- Broadened aliases (depot, closing_balance, plan_qty, vendor, material, net_value, required_date…) driven by structure, never by workbook names.

**`classify.ts` rework**
- Per-sheet outputs extended: `domain`, `role`, `grain`, `timeOrientation` (historical | current_state | forward | policy), `scope`, confidence, disposition, plain-language reason.
- **Forecast**: period column with majority future periods + baseline/low/high-shaped measures → `demand_forecast`.
- **Consumption/movement**: SKU+date+signed quantity, no price/customer → `inventory_movement`, disposition "unsupported — surfaced, not imported".
- **Snapshot vs movement**: on-hand levels with an as-of date vs dated deltas.
- **Policy sheets**: parameter/value/unit shape → `planning_policy` domain, feeds Phase 4.
- **Documentation**: section/description-shaped sheets → `documentation` role, excluded from import, labeled explicitly; reliable dictionary statements ("X = month-end inventory position") are parsed as *secondary* evidence that can raise confidence — contradictory data always wins.
- **Unsupported surfacing**: unrecognized sheets with plausible business structure get an "unsupported" disposition with counts and a plain-language explanation instead of silent ignore.
- **Multi-signal confidence**: header + type + value pattern + grain + cross-sheet relationship + orientation combined into HIGH/MEDIUM/LOW; HIGH auto-imports, MEDIUM requires review, LOW blocked.

## Phase 3 — Canonical forecast domain

**Migration** (one, via approval flow):
- `public.demand_forecasts`: product ref, optional location, period month, baseline/low/high quantities, method, import-batch attribution, deterministic `source_row_hash` dedupe, created_at.
- Composite org FK to products using column-specific delete action (the fixed pattern); GRANTs to authenticated/service_role (no anon); RLS: members read, members write within their org — mirroring purchase_orders.
- `import_batches` lifecycle extended: forecast rows join inactive-batch exclusion, `deleteBatchRows`, and `batchDemandFootprint` so deactivate/reactivate/delete treat forecasts exactly like transactions.

**Code**: `CanonicalForecast` in the domain model; `demand_forecast` case in `canonicalise.ts` (future periods accepted here — history rules stay unchanged); `persistForecasts` in the repository; `importUpload` persists and audits them.
Forecasts are stored with full provenance and shown in the import summary; **planning-engine consumption is deferred** (reported as a gap, not hidden).

## Phase 4 — Planning Policy integration

**New `policy-detect.ts`**
- Extract parameter candidates from policy-shaped sheets; normalized-label matching onto existing `PlanningPolicy` fields (service level, horizon, demand window, safety stock, lead time, MOQ, order multiple, growth, seasonality).
- **Scope detection**: a row carrying a SKU/supplier/location column is a specific-scope value, never an org-level overwrite. Specific values become attribute proposals; existing more-specific values are never overwritten silently.
- **Value fidelity**: scalar/percent/boolean parse; **ranges and qualitative tokens are never collapsed** — they become `needs_review` proposals with an explanation ("workbook specifies a range; the policy field holds a single value").

**Proposal flow**
- `inspectUpload` returns `policyProposals`: `{ field, currentValue, proposedValue, unit, scope, status: accept_ready | conflict | needs_review, reason }`.
- `importUpload` accepts `policyDecisions: [{ field, action: "accept" | "keep" }]`. Accept applies through the existing `savePlanningPolicy` path; **owner/admin only** (same rule as `updatePlanningPolicy`); every decision audited.
- Policy decisions are independent of data import — rejecting every proposal still imports the workbook.

## Phase 5 — Wizard UX

- Summary band extended: ready / needs review / unsupported-contextual / policy proposals.
- New **"Planning parameters found"** panel: current Ionic value vs workbook proposal per parameter, with **Accept / Keep existing** controls; conflicts and ranges marked for review with the reason.
- **Unsupported** section: "recognised as consumption / documentation / forecast-shaped but no destination" cards with counts and confidence — useful data is never silently dropped.
- Sheet evidence shows grain and orientation ("forward-looking: 12 periods from Sep 2026", "one row per SKU per month").
- `import_batches.sheet_summary` enriched: domain, role, grain, orientation, confidence, disposition, warnings.

## Phase 6 — Verification

**Regression fixture (Cloud Ltd shape)**: synthetic workbook with the described sheets (Supplier/Customer/SKU masters, Sales_Transactions, Consumption, Purchase_Orders, Inventory_Snapshots, Future_Demand_Baseline, Assumptions, README, Data_Dictionary, Validation_Summary) asserting the expected *semantic* outcomes. **Control run with all sheets renamed "Sheet 1..12" must produce identical classifications** — proving meaning-over-names.

**Generalization fixtures** (section 20 terminology): Stock_Code/Depot/Closing_Balance/As_At → inventory; Invoice_No/Txn_Date/Item_No/Units/Net_Value → transactions; Period/Material/Plan_Qty/Low_Case/High_Case → forecast; Order_Number/Vendor/Material/Required_Date/Qty_Ordered → PO; Section/Description → documentation; Parameter/Value/Unit → policy inputs. Flat-file CSV through the same pipeline.

**Lifecycle regression**: forecasts deactivate/reactivate/delete with their batch; unrelated batches untouched; no duplicates on re-import.

**Policy flow tests**: proposals generated; accept updates policy + audit; keep-existing leaves policy untouched; import commits with all proposals rejected; range values stay in review.

**Full pass**: `bun test`, `tsgo` typecheck, production build, Playwright smoke of the wizard (upload → analyze → review exceptions → policy accept/keep → import).

**Final acceptance**: you re-attach the real workbook; it must be understood without any workbook-specific rules.

## Constraints (unchanged)

No Cloud Ltd hardcoding; no second pipeline; RLS and `org_id NOT NULL` intact; no service-role exposure; no silent policy overwrites; no range collapse; import lifecycle (active/inactive/deleted, audit, inactive planning exclusion) preserved; no unrelated rewrites.

## Deferred (reported, not hidden)

- Planning-engine consumption of stored forecasts.
- Canonical inventory-movement/consumption domain.
- Deeper documentation-driven mapping beyond evidence hints.
- Multi-currency normalization beyond the existing currency-code capture.
