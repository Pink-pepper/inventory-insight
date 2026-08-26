# Ionic — Finishing the Consolidation Pass

You're right: about half of the approved pass shipped. Here is what is verified done, what is missing, and how the remainder gets built.

## Already in place (verified)

- Projects: `projects`, `project_products`, `project_activities` tables, repository, server functions and the `/projects` screen.
- Products and Suppliers: packaging fields on products, `master-repository`, `/master/products`, `/master/suppliers`.
- Business Plan: `business_plans`, `business_plan_lines`, targets, bottom-up seeding, top-down allocation, reconciliation gap and the `/business-plan` screen.
- Migration for display currency and FX rates on the org planning policy (columns exist).
- Helper modules `src/lib/domain/currency.ts` and `src/lib/domain/uom.ts` were written.

## Not done (the missing half)

1. **Control Tower dashboard** — `src/lib/control-tower/signals.ts` does not exist; `/overview` is still the old summary page.
2. **Navigation and IA regroup** — sidebar still shows the old groups plus a "Master data" group; Distribution and Landed Costs were never moved out; Pipeline is still a top-level entry beside Projects; no collapsible groups.
3. **Demand Book language** — still says "resolved demand", "run rate", "weighted upside" in the UI.
4. **Customers and Market Signals rework** — both screens are unchanged; no relationship summaries, no grouped intelligence feed.
5. **Quantity / UOM display** — `domain/uom.ts` is imported nowhere; no pack-size columns, no g/kg/MT/L switch.
6. **Display currency** — `domain/currency.ts` is imported nowhere; no settings control, no conversion in the formatting layer.
7. **Visual system and homepage** — tokens are still the old green/cream set (not `#F7F6F1` / `#0F4F48` / `#1B281C`), Satoshi is not loaded, and `src/routes/index.tsx` is still the old 103-line homepage.

## What gets built now

### A. Control Tower

New `src/lib/control-tower/signals.ts` deriving prioritised rows from data already loaded: shipment ETA slips, projection cover breaches, ageing quotations, landed cost above quoted price, demand shifts, slow movers, unmatched committed demand, market signals. Categories Urgent / Attention / Opportunity / Information / Healthy. `/overview` is rebuilt as that briefing: each row expands to what happened, why it matters, the evidence and a link to the record. No new tables, no fabricated signals.

### B. Navigation and IA

Regroup to Workspace · Business (Customers, Projects, Demand Book, Market Signals) · Inventory (Inventory, Products, Suppliers) · Planning (Demand Plan, Supply Plan, Business Plan, Scenarios) · Supply (Procurement, Shipments, Inbound) · Analytics · Data. Business and Inventory become collapsible. Distribution becomes a "Coming soon" entry under Planning; Landed Costs leaves the sidebar and is reached from Procurement, Products, Shipments and POs. Pipeline folds into Projects. All existing URLs keep working.

### C. Language, Customers, Signals

Demand Book wording only: Total expected demand / Expected demand / Potential demand; resolver untouched. Customers gains plain-language relationship summaries and drill-down into that customer's projects, quotations, orders, sales and signals. Market Signals is restyled as a grouped, expandable intelligence feed that never alters numbers.

### D. Quantity, UOM and currency

Inventory and demand tables adopt In stock (units) · Pack size · Quantity · Days of cover · Expected stock, with a display-level g/kg/MT/L switch using product pack factors only. A workspace display-currency setting with manual rates, applied in one shared formatting layer across every money surface and clearly labelled as a display conversion — source amounts are never overwritten.

### E. Visual system and homepage

Token changes in `src/styles.css`: background `#F7F6F1`, primary `#0F4F48`, strong text `#1B281C`, warm cream surfaces, sparing semantic accents, lighter borders and quieter tables. Satoshi loaded via a `<link>` in the root route. Homepage rebuilt on the new system with the Distribution "Coming soon" block and both CTAs.

## Technical notes

- No new tables; the display-currency and pack-size columns already exist.
- New code is confined to `src/lib/control-tower/`, presentation layers, `app-shell.tsx`, `styles.css`, `__root.tsx` and the affected route files, plus wiring the two existing domain helpers.
- Verification: `tsgo` typecheck, unit tests for control-tower signals, UOM/pack maths and currency conversion, and a Playwright walkthrough of every route in the new navigation.

## Sequencing

Given the size, this runs in three stages so you can review as it lands: (1) Control Tower + navigation, (2) language, Customers, Signals, UOM and currency, (3) visual system and homepage.

Proceed with the three-stage continuation exactly as described.

One important preservation requirement: Requirements and Opportunities are no longer primary Pipeline navigation items, but they must remain available as demand sources/types in the Demand Book and accessible from relevant Project detail. Do not delete or migrate away those underlying records.

Otherwise, proceed with stages 1 → 2 → 3. Do not rebuild Projects, Products, Suppliers, Business Plan, currency schema, or UOM helpers that are already in place. No publish/deploy.