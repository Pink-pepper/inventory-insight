# Ionic — Package 5: Distribution Planning & Procurement Visibility

Architecture and implementation proposal based on the actual Packages 1–4 codebase. Supply Planning stays authoritative for projected inventory, net requirement, suggested replenishment and supply risks; Package 5 consumes those outputs and never recomputes them.

---

## A. Current architecture — what Package 5 reuses

**Supply engine (src/lib/supply/, pure functions, no I/O):**
- `buildSupplyPlan({ facts, engineRows, openSupply, policy, filter })` → per-SKU `SupplyPlanRow` with `projection`, `lowPoint`, `firstStockout`, `firstBelowSafety`, `netRequirement`, `suggestedQty`, `requiredByPeriod`, `orderByDate`, `riskFlags`, plus `excessLocations` (per-location cover heuristic) and a structured `explanation`. Summary includes `excessLocationOpportunities`.
- `projectPosition` — month-phased on-hand − demand + ETA-phased receipts; past-due receipts land in period 1.
- `computeNetRequirement` — max(0, target − lowPoint), MOQ/order-multiple rounding, order-by = trigger period − lead time.
- `explainSupplyRow` / `riskText` — explanations only quote numbers already on the row.

**Data layer (src/lib/data/repository.ts):**
- `loadSignals` — per-SKU `locations: InventoryPosition[]` (location, onHand, onOrder, asOf) alongside aggregate onHand/onOrder. This is the multi-location inventory foundation and already feeds Package 4's excess detection.
- `loadOpenSupply` — POs with `status='placed'` and outstanding > 0, with per-line `expectedAt`, `orderedAt`, `outstanding`, `poId`.
- `persistPurchaseOrders` — insert-only with `source_row_hash` re-import dedupe; supplier matched by code or name; `unit_cost` falls back to product cost.
- `loadDemandFacts` — monthly facts (org-aggregate) and day-grain transaction facts carrying `locationCode/locationName/region/stateProvince/country`.
- `resolveOrg`, `getPlanningPolicy`, `audit`, `createImportBatch` — tenant + provenance plumbing.

**Ingestion:** `purchase_orders` entity exists end-to-end (`inspectUpload` → mapping with aliases incl. `po_ref`/`po_status`/`expected_at`/`received_quantity` → `canonicalise` validation → `persistPurchaseOrders`). `PO_STATUS_MAP` normalises ~20 source status words onto the 4-value lifecycle.

**UI patterns:** `AppShell` nav, `PlanningFilters` (shared filter spec), `StatusBadge`, `useProductLabel`, `EmptyState`/`Loading`/`TableSkeleton`, Recharts, route-level `head()`. Server-fn pattern: `createServerFn` + `requireSupabaseAuth` + zod input + `resolveOrg`.

**Key gaps discovered (stated, not assumed):**
1. `po_ref` is parsed and validated during ingestion but **never persisted** — `purchase_orders` has no PO-number column. Re-import dedupe works via hash, but users cannot see a PO number.
2. PO status is one enum (`draft, placed, received, cancelled`) that conflates approval and fulfilment — `approved` currently maps to `placed`.
3. No receiving location, buyer, currency, actual receipt date, or approval state on `purchase_orders`.
4. Location-level **demand** exists only where `sales_transactions` carry a location; monthly `sales` is org-aggregate. Org-aggregate planning never sees which location demand occurs in.
5. No inventory freshness data anywhere (no receipt dates, lots, or batches; `inventory.as_of` is a snapshot date only).

---

## B. Distribution dependency map

```text
loadDemandFacts (monthly + transaction facts)
  → buildDemandPlan / computeBaseline          (Package 3, aggregate)
  → buildSupplyPlan (Package 4, authoritative)
      → SupplyPlanRow.netRequirement / suggestedQty / orderByDate
      → SupplyPlanRow.excessLocations (signal only, no quantities)
  → NEW: buildDistributionPlan (Package 5, pure, src/lib/distribution/)
      → per-location demand signal (transactions) + per-location positions
      → TransferOpportunity[]  (opportunity DETECTED only)
  → residual external requirement = supply netRequirement
      (transfer reduces procurement ONLY in a later confirmed-transfer workflow)
```

`buildSupplyPlan` is not modified. Distribution reads its rows as input.

## C. PO dependency map

```text
CSV/XLSX → SheetTable → mapping (aliases) → canonicalise (validation, PO_STATUS_MAP)
  → persistPurchaseOrders (dedupe, supplier match, batch provenance)
  → purchase_orders (+ new columns: po_number, approval_status, received_at,
                     location_id, currency_code, buyer)
  → loadOpenSupply (supply projection input) AND listPurchaseOrders (Inbox)
  → PO Inbox UI ← join to SupplyPlanRow by SKU for "what requirement does this PO satisfy"
```

---

## D. Data availability matrix

| Capability | Exists? | Current source | Sufficient? | Package 5 change |
|---|---|---|---|---|
| Multi-location inventory | Yes | `inventory.location` + `location_id`, `SkuSignal.locations` | Yes | None |
| Location demand | Partial | `sales_transactions.location_id` only; monthly grain is aggregate | Partial — only for orgs importing transactions | Distribution marks "location demand unknown" instead of inventing a split |
| Excess inventory | Partial | Package 4 `excessLocations` cover heuristic (aggregate demand) | Signal yes, quantity no | New per-location transferable-quantity calc |
| Net supply requirement | Yes | `buildSupplyPlan.netRequirement` | Yes (aggregate) | Consumed, not recomputed |
| PO number | Partial | Parsed (`po_ref`), NOT persisted | No | Add `po_number` column + persist |
| PO status | Yes | `po_status` enum (draft/placed/received/cancelled) | Yes as lifecycle | Kept; fulfilment view derived |
| Approval status | No | — (collapsed into `status` today) | No | New `po_approval_status` enum + column |
| Fulfilment status | Partial | Derivable from `status` + `received_quantity` + `expected_at` | Yes as derived view | Pure derivation function; optionally add `closed` enum value |
| Quantity ordered | Yes | `purchase_orders.quantity` | Yes | None |
| Quantity received | Yes | `received_quantity` | Yes | None |
| Outstanding quantity | Yes | Derived in `loadOpenSupply` | Yes | Reused |
| ETA | Yes | `expected_at` | Yes | None |
| Actual receipt date | No | — | No | Add `received_at date` |
| Supplier | Yes | `supplier_id` matched by code/name | Yes | None |
| Unit cost | Yes | `unit_cost` (fallback to product cost) | Yes | Total cost derived, never stored |
| Currency | No | — (`sales_transactions.currency_code` only) | No | Add nullable `currency_code`; no FX, no cross-currency totals |
| Receiving location | No | — | No | Add nullable `location_id` |
| Buyer/planner | No | — | No | Add nullable free-text `buyer` (user linkage deferred) |
| Inventory age | No | No receipt dates, lots, or batches | No | Defer freshness-aware transfers (see §9) |
| Transfer lead time | No | — | No | Future policy inputs; v1 transfers are undated with the limitation stated |
| Transfer cost | No | — | No | Future policy input |

## E. Proposed schema changes (minimum additive, one migration)

1. `purchase_orders` additive columns:
   - `po_number text null`
   - `approval_status po_approval_status not null` with new enum `po_approval_status ('needs_review','approved','rejected')`
   - `received_at date null`
   - `location_id uuid null` → `locations`, plus composite `(org_id, location_id)` FK matching the existing hardening pattern
   - `currency_code text null` (ISO-4217 validated on write)
   - `buyer text null`
2. `ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'closed'` — lets a short-received PO be closed without faking a full receipt.
3. RLS/grants: columns inherit existing `purchase_orders` policies; add one `UPDATE` policy allowing owner/admin to set `approval_status` only if the current update policy is member-wide (verify at implementation; RLS remains the enforcement boundary).
4. No distribution table in v1: opportunities are computed on the fly exactly like the supply plan. A `transfer_recommendations` table (status: recommended → approved → executed) is deferred to the transfer-approval workflow phase.

Backfill decision (flagged, recommendation only): existing imported POs are records of external systems where they already exist, so the migration backfills `approval_status='approved'` for rows with `status in ('placed','received')`; new imports default per mapping (see §G).

## F. Distribution calculation design (deterministic, transparent)

New pure module `src/lib/distribution/` (mirroring `src/lib/supply/` structure):

- `positions.ts` — per SKU × location: onHand, onOrder, per-location daily demand derived **only** from transaction facts at that location; `demandKnown: false` when a location has no transaction history.
- `opportunities.ts` — per SKU with `netRequirement > 0`:
  - **Source:** location cover = onHand / locationDailyDemand. Excess threshold reuses the existing engine rule `(leadTime + safetyDays + excessCoverThresholdDays)` — same definition as Package 4, now with location demand where known. `transferable = max(0, onHand − own target)`.
  - **Destination:** location whose projected position falls below its safety stock within the horizon, with `requirement = target − lowPoint` at location grain.
  - **Suggested transfer qty = min(sourceTransferable, destinationRequirement)**, integer-rounded; no split optimisation, one suggestion per source→destination pair sorted by requirement urgency then excess size.
  - Locations with `demandKnown: false` are never sources or destinations for quantities; they appear as "insufficient location demand history" notes.
- `explain.ts` — same pattern as `explainSupplyRow`: every quoted number exists on the opportunity row. Example output: "Location A holds 620 units beyond its own requirement while Location B is projected below safety stock in 3 weeks; a transfer of up to 500 units could reduce the external replenishment requirement."
- Explicit state machine, v1: opportunities are only ever **detected/recommended** — computed, never persisted, never mutating inventory or the supply plan. The supply plan's `suggestedQty` remains the external procurement figure; the UI shows "potential internal supply: up to N units" alongside it rather than subtracting it.

Non-goals honoured: no optimisation solver, no stock movements, no automatic POs.

## G. PO Inbox architecture

**Status model (two independent dimensions):**
- Approval: stored `approval_status` (`needs_review | approved | rejected`). Mapping change: `PO_STATUS_MAP` no longer folds `approved` into `placed` — source "approved" sets `approval_status='approved'`, source status words map to lifecycle only. Unmapped/new imports default `approval_status='needs_review'` when the source provides no approval signal, `approved` when it does.
- Fulfilment: **derived** pure function `fulfilmentStatus(po)` in `src/lib/domain/purchase-order.ts`: `cancelled` (status), `delivered` (received ≥ ordered or status received with received_at), `partially_received` (0 < received < ordered), `open` (placed, nothing received), `closed` (new status value). Never a second stored enum to drift out of sync.

**Data access:** `listPurchaseOrders(supabase, orgId)` in repository — all statuses (unlike `loadOpenSupply`), joined to product/supplier/location, with `import_batch_id` provenance and derived outstanding/total cost. New server fn `getPurchaseOrders` (filter: `planningFilterSchema` + `status`, `approvalStatus`, zod-validated) and `setPurchaseOrderApproval` (owner/admin only, audited).

**UI:** new route `_authenticated/purchase-orders.tsx` + nav entry (e.g. "Purchasing", `ClipboardList`-adjacent icon) using existing primitives only:
- Status summary cards (open / partially received / delivered / needs review counts).
- `PlanningFilters` (SKU, supplier, location) + status/approval chips.
- PO table: PO number, product (via `useProductLabel`), supplier, ordered/outstanding, ETA, derived fulfilment badge, approval `StatusBadge`, total cost with currency code (no FX; mixed currencies shown per-row, never summed).
- Expandable row: ordered/expected/received dates, receiving location, buyer, unit cost, import batch provenance, and supply-plan linkage — the matching `SupplyPlanRow` context ("covers a net requirement of N units, order-by date D") so the planner sees why the PO exists.

## H. Security

- All new server functions: `requireSupabaseAuth` + server-side `resolveOrg`; org never from client input. `attachSupabaseAuth` middleware already registered.
- New columns sit under existing `purchase_orders` RLS (member read; composite FK prevents cross-tenant location linking).
- Approval changes: owner/admin only, checked in the handler (defence in depth) and by an RLS update policy; every change written to `audit_logs` (`po.approval.updated`).
- Ingestion: reuses the existing validated pipeline (size caps, row caps, `safeText`, `parseNumber`/`parseDate`, dedupe) — no new import surface.
- Distribution: read-only computation; members can view. Transfer approval/execution permissions are defined when that workflow phase is planned, not now.

## I. Backward compatibility

- All schema changes are additive/nullable; Packages 1–4 read paths untouched. `loadOpenSupply` continues to work unchanged.
- `po_status` gains one value; existing rows and `PO_STATUS_MAP` behaviour preserved (`received` stays `received`; `closed` previously mapped to `received` — mapping updated so source "closed" maps to the new value, which is strictly more accurate).
- `buildSupplyPlan` unmodified; supply-plan UI unchanged except optionally showing the "potential internal supply" line.
- Package 4's `excessLocations` signal stays as-is; Package 5's per-location calc supersedes it only on the new Distribution screen.
- Approval backfill marks existing imported POs `approved` — no workflow interruption for existing workspaces.

## J. Risks / unknowns

1. **Location demand coverage:** orgs on monthly-only imports have no per-location demand. Distribution v1 will surface "insufficient location history" rather than fabricate splits — product decision: acceptable, or do we later add an allocation assumption (explicitly out of scope now)?
2. **Single- vs multi-location UX:** detection = count of distinct locations in inventory/locations. v1 shows a "not applicable — single location" state on the Distribution screen; full context-aware UX polish deferred as instructed.
3. **Approval backfill semantics** (§E) — needs confirmation at implementation.
4. **Transfer lead time/cost absent** — v1 transfer suggestions are undated; stated as a limitation in every explanation.
5. **PO number uniqueness:** source files may repeat or omit PO numbers; `po_number` is display/provenance only, dedupe stays on `source_row_hash`.

## K. Implementation sequence (smallest safe phases)

- **5A — PO data foundation:** migration (§E); extend `purchase_orders` ingestion optional fields (`po_number` persist, `received_at` via new `received_at` aliases, `currency_code`, `location`, `buyer`); update `PO_STATUS_MAP`; `fulfilmentStatus` domain function + unit tests.
- **5B — PO Inbox:** `listPurchaseOrders`, `getPurchaseOrders`, `setPurchaseOrderApproval` server fns; route + nav; summary, filters, table, expandable detail with supply-plan linkage.
- **5C — Distribution engine:** `src/lib/distribution/` pure module (`positions`, `opportunities`, `explain`) consuming `buildSupplyPlan` rows + `loadSignals` locations + transaction facts; fixture tests mirroring `supply.test.ts`.
- **5D — Distribution UI:** new route + nav; single-location "not applicable" state; opportunity table with source→destination, quantities, explanation; "potential internal supply" surfaced on Supply Planning rows.
- **Later (explicitly not Package 5):** transfer recommendation persistence + approval lifecycle, PO creation in Ionic, Plan vs Actual, Scenario Planning.

## L. Outside capability

- **Freshness-aware transfers:** no receipt dates, lots, or batches exist; cannot be done without inventing data. Deferred (option C from §9 of the brief) — requires a future receipt/lot ingestion entity.
- **Transfer lead time/cost optimisation:** no source data; deferred to policy inputs in a future package.
- **FX/currency conversion:** no rates source; totals shown per currency only.
- **Ionic-created POs / procurement execution:** no creation workflow exists; imported POs remain external-source records. If wanted, it is a separate phase with its own approval design.
- **Real-time ERP sync of PO status:** out of scope; PO state refreshes via re-import (dedupe by hash means status changes need updated-row semantics — flagged: current dedupe skips changed rows rather than updating them, so a PO that moves to "received" in a re-import is not reflected. A minimal `ON CONFLICT (org_id, source_row_hash) DO UPDATE` for status/quantity fields is included in 5A to make PO Inbox truthful).
