# Package B — Landed Economics and Shipments

Continuation of the approved B2B Distributor Core Redesign. Package A (commercial spine, Demand Book) is complete. This package answers "can I buy this and still make money, and when does it actually land?" — no scope change, no new engines.

## Schema (one migration, existing patterns: org_id, composite (org_id, id) FKs, GRANTs, is_org_member RLS)

- `supplier_products` — supplier + product, supplier price, currency, MOQ, lead time days, active flag.
- `cost_components` — freight, duty, clearance, other, FX rate, attached to product, supplier or shipment; per-unit or per-shipment basis.
- `shipments` — org, supplier, reference, mode, lifecycle status (planned, booked, in transit, arrived, clearing, cleared, delivered, cancelled), ETD, ETA, revised ETA, actual arrival, currency.
- `shipment_lines` — shipment, purchase order, product, quantity, unit cost; one PO fans out to many shipments.

Delay is derived (revised/actual vs original ETA), never stored as a separate status.

## Landed cost service

New `src/lib/economics/landed-cost.ts`, a single pure function chain: supplier price → freight → duty → clearance → other → FX → landed unit cost → selling price → gross profit → margin. Each step keeps its contribution so the UI can show the build-up. `products.unit_cost` remains the fallback when no components exist, so every existing reader keeps working unchanged.

## Supply projection

`src/lib/supply/plan.ts` currently phases inbound supply from one `expected_at` per PO line. It will instead phase from shipment ETAs where shipment lines exist for a PO, falling back to `expected_at`, then to unscheduled. The netting and projection math in `netting.ts`/`projection.ts` is untouched.

## Data access and server functions

Extend `src/lib/data/repository.ts` (or a sibling `supply-repository.ts` if the file grows past comfort) with org-scoped readers/writers for supplier products, cost components, shipments and lines, plus a supply server-function module in the existing `.functions.ts` style. Org identity stays server-derived.

## UI

Supply section gains:
- **Shipments** — list with lifecycle, ETA vs revised ETA, delay, linked PO(s), lines; create/edit/receive.
- **Inbound** — a time-ordered arrivals view (what lands when, against which demand).
- **Import/Clearance** — shipments in clearing states with their cost components.
- Existing **Purchase Orders** inbox preserved, plus a **landed economics panel** on a PO/product showing the cost build-up, selling price, GP and margin.

## Demo data

`src/lib/connectors/demo-dataset.ts` extended with supplier prices, cost components and multi-shipment POs for the existing 50 SKUs — extended, not replaced.

## Verification

`tsgo` typecheck, existing unit tests plus new landed-cost and shipment-phasing tests, and a Playwright walkthrough of the Supply routes. No publish or deploy.
