# Ionic — B2B Distributor Core: Final Consolidation + UX Pass

One consolidated pass on the existing app. Packages A and B stay in place; this finishes the core, simplifies the interface and adds the few missing modules. No rebuild, no new engines, no publishing.

## What exists today (verified)

- Routes: `overview`, `inventory`, `demand-planning`, `supply-planning`, `distribution`, `purchasing`, `recommendations`, `scenarios`, `data-sources`, `settings`, `sku/$sku`, `business` (Demand Book), `business/pipeline`, `business/customers`, `business/signals`, `supply` (shipments), `supply/inbound`, `supply/economics`.
- Engines already in place: inventory engine, demand baseline + Demand Book resolver, supply netting/projection, shipment phasing, landed cost, scenario engine, analytics summary, ingestion/ETL.
- Navigation groups today: Dashboard · Business · Planning · Supply · Data (defined in `src/components/app-shell.tsx`).
- Not present yet: Products and Suppliers screens, Business Plan (no tables), a Projects concept, pack-size fields on products, and a global display currency.

## What changes

### 1. Navigation and information architecture
Regroup the sidebar to: Workspace (Dashboard) · Business (Customers, Pipeline, Demand Book, Market Signals) · Inventory (Inventory, Products, Suppliers) · Planning (Demand Plan, Supply Plan, Business Plan, Scenarios) · Supply (Procurement, Shipments, Inbound) · Analytics · Data (Data Hub, Settings). Business and Inventory groups become collapsible.

Distribution Planning leaves the sidebar but keeps its route and engine, reachable from Planning as a "Coming soon" entry. Landed Costs leaves the sidebar and is reached contextually from Procurement, Products, Shipments and purchase orders — the existing `/supply/economics` screen and its build-up stay exactly as they are. All current URLs keep working; renames are handled with redirects.

### 2. Dashboard as Control Tower
Replace the current overview content with a prioritised operator briefing driven by a new `lib/control-tower/signals.ts` that reads only existing loaded data (shipments/ETAs, projection cover, quotation ages, landed cost vs quoted price, demand shifts, slow movers, unmatched committed demand, market signals). Categories: Urgent, Attention, Opportunity, Information, Healthy. Each row expands to what is happening, why it matters, the evidence, a link to the record, and a suggested next action. Demo-derived rows carry a "demo" label. No fabricated signals; no new persistence.

### 3. Pipeline becomes Projects
New `projects` table (org-scoped, RLS + GRANTs, same patterns) plus `project_products` and `project_activities`, with a flexible stage list (Identified → Engaged → Requirement Confirmed → RFQ/Proposal → Sampling/Trial → Negotiation → Customer Decision → Won/Order → Fulfilment → Delivered/Closed → Lost). Stages are optional per project.

Pipeline lists active projects compactly: Customer · Project · Products · Stage · Potential value, with drill-down to a project detail showing linked requirements, opportunities, quotations, orders, activities and expected economics. Requirements and Opportunities stop being top-level Pipeline tabs and become demand sources/types surfaced in the Demand Book; a demand signal can be promoted into a project without duplicating the demand record — the original signal remains as evidence.

### 4. Demand Book language
Keep the resolver unchanged. User-facing wording only: "resolved demand" → Total expected demand, "run rate" → Expected demand, "weighted upside" → Potential demand. Source labels keep Requirement / Opportunity / Quotation / LPO / Order / History / Market / Planner. Evidence expansion stays.

### 5. Customers and Market Signals
Customers gets relationship-level summaries in plain language (Active customers, Pending quotations, Active projects, Outstanding orders) and drill-down into that customer's projects, quotations, orders, sales and signals. Market Signals stays standalone and is restyled as a contextual intelligence feed (grouped by category/entity, expandable, with strategic implication) rather than a CRUD table. Signals never alter numbers.

### 6. Products and Suppliers
Two new Inventory screens over existing tables. Products adds packaging and identity fields to the `products` table (`pack_size`, `pack_uom`, `unit_count`, plus optional spec/regulatory/hazard notes) and shows identity, packaging, commercial (default selling price, landed cost, GP, margin), supply (from `supplier_products`) and information, with inline editing of master data. Default product price never overwrites historical transaction prices. Suppliers shows identity, contacts, products supplied, prices/currency/MOQ/lead time, terms and available performance — a reference view, not an ERP.

### 7. Quantity, UOM and product display
Inventory and demand tables adopt: In stock (units) · Pack size · Quantity (units × pack size) · Days of cover · Expected stock. A display-level UOM switch (g / kg / MT / L) converts physical quantity using product-specific factors only; no invented mass/volume conversion. The existing `productDisplay` policy drives a Product name / SKU toggle wherever products are listed.

### 8. Display currency
A workspace display-currency setting with manual rate entry (stored on the org planning policy). Source amounts and currencies are never overwritten; conversion happens in a single formatting layer used across Dashboard, Inventory, Products, Suppliers, Procurement, landed cost, Pipeline, Demand Book, Business Plan, Scenarios and Analytics. Clearly marked as a display conversion, not accounting-grade FX.

### 9. Business Plan
New `business_plans` and `business_plan_lines` tables. Annual revenue and gross-profit targets with contribution lines by supplier / product / customer (quantity, revenue, GP, margin). Bottom-up seeds lines from the Demand Book plus landed economics; top-down allocates a target across dimensions by share. The reconciliation gap between lines and targets is always shown, per dimension. "What if" reuses the existing scenario engine — no second planning engine. Create → Adjust → Run → Compare → Save → Export.

### 10. Visual system and homepage
Token-level changes in `src/styles.css`: background `#F7F6F1`, primary `#0F4F48`, strong text `#1B281C`, warm cream surfaces, semantic sage/orange/red/blue/mustard used sparingly. Satoshi as the primary typeface loaded via a `<link>` in the root route. Lighter borders, restrained shadows, quiet tables, generous spacing; component structure is preserved. The homepage is rebuilt on this system with the supplied copy, including the Distribution Planning "Coming soon" block and both CTAs.

### 11. Preserved untouched
Ingestion/ETL and Data Hub, provenance, exports (reused, not duplicated), analytics module and engine, landed-cost calculation and UI, scenario engine, auth/RLS/org-scoping, demo dataset (extended with projects and pack sizes rather than replaced), distribution engine.

## Out of scope (explicitly not built)
PFI generator, OCR/document intelligence, intelligent Excel reconciliation, task management, the full analytics expansion, a mobile redesign.

## Technical notes
- New tables (`projects`, `project_products`, `project_activities`, `business_plans`, `business_plan_lines`) follow the existing pattern: `org_id`, composite `(org_id, id)` FKs, GRANTs in the same migration, `is_org_member` RLS.
- Product/policy column additions are additive and nullable so existing reads keep working.
- All access goes through the existing repository + server-function modules; org identity stays server-derived.
- No new dependencies apart from the Satoshi webfont link.
- Verification: `tsgo` typecheck, existing plus new unit tests (control-tower signals, project→demand non-duplication, UOM/pack maths, currency conversion), and a Playwright walkthrough of every route in the new navigation.
