# Ionic — MVP hardening and design system pass

A refinement of the existing app. The architecture (canonical model → connector → database → rule engine → analytics → UI) stays exactly as it is; every change below is an extension of it.

## What I verified first

- `loadSignals()` reads inventory without `location` and keeps only one row per product, so a SKU stocked in two locations silently loses one position.
- The same function falls back to a 14-day lead time and a 1-unit MOQ when supplier data is missing, with no signal to the user.
- `explain()` produces one long paragraph; the recommendations table shows a 2-line clamp of it.
- Recommendations are upserted on `(org_id, product_id)` with `generated_at`, but there is no run identifier, so a stored recommendation cannot be tied to the import that produced it.
- The CSV connector validates only missing SKU and unparseable dates.
- Organization identity is already derived server-side from membership in `resolveOrg()`; no server function trusts a client-supplied `org_id`. No change needed there.
- Palette is currently navy/slate.

## 1. Data and engine hardening

**Location awareness.** `loadSignals()` will read `location` and aggregate all locations for a SKU into the decision position, while carrying a `locations: { location, onHand, onOrder, asOf }[]` array on the signal. The SKU detail page shows the per-location breakdown with an explicit note that the MVP plans at the aggregate level and does not optimise allocation across locations. No multi-echelon logic.

**On-hand vs on-order.** Both values already exist separately; the change is to stop blurring them in output. Days of cover stays on-hand only (already correct). The engine returns a structured breakdown separating physical stock from incoming stock, and the UI labels them distinctly. Where a matching `purchase_orders` row carries `expected_at`, the earliest expected arrival is surfaced as informational context. No inbound forecasting.

**No invented critical data.** The engine gains a `dataQuality` result: a list of missing critical inputs (supplier lead time, unit cost, sales history, MOQ). When lead time is unknown the SKU is classified `WATCH` with the reason "Supplier lead time is missing — a reliable reorder point cannot be calculated" instead of quietly assuming 14 days. Products that do carry a lead time (including all demo data) behave exactly as today.

## 2. Ingestion validation

Extend the CSV connector's existing issue list with per-row severity (`error` = row rejected, `warning` = row accepted with a caveat): missing SKU, duplicate SKU with conflicting attributes, invalid or future dates, negative on-hand/on-order/sales/cost, non-numeric values, missing supplier, missing unit cost, unmapped columns. The upload result panel on Data Sources shows rows accepted, rows rejected, warnings, and the reason per row. Nothing is discarded silently.

## 3. Provenance

Add a `run_id` (uuid) and `run_started_at` to `recommendations`, written on each regeneration alongside the existing `generated_at`. The recommendations screen and SKU detail show when the current view was calculated and which run the stored row came from, and flag when stored results are stale relative to the latest import. Audit log entries for imports and regenerations record the same run id.

## 4. Recommendation presentation

`explain()` becomes the source of a structured explanation object — recommendation, why, demand, inventory, policy, estimated spend — with the existing paragraph kept as a fallback summary. The UI renders those fields; no calculation moves into components. The table gets a row expander (or detail panel) showing the structured breakdown instead of a clamped paragraph.

## 5. Demand trend

`demandTrendPct` continues to display as an informational signal only. It does not change quantities.

## 6. Security, tenancy, audit

RLS and policies unchanged. Adding `run_id` requires a migration; grants and policies on `recommendations` are preserved as-is. Audit coverage extended to data deletion and workspace configuration changes. No secrets logged.

## 7. Design system — natural green and earth tones

Rewrite the tokens in `src/styles.css` only; component structure stays. Warm off-white and stone backgrounds, charcoal text, deep forest green as primary, moss and sage as accents. Status colours re-tuned to restrained naturals: clay red for reorder, ochre for watch, moss for hold, muted slate-olive for excess. Charts move to an earth-tone sequence. All text and interactive pairs checked for WCAG AA.

Alongside the palette: a single type scale reused across pages, one spacing rhythm, two border-radius values, subtle hover states only, icons sized to their text. Remove any decorative element that carries no information.

## 8. UX states and copy

Audit every async action for loading, disabled-while-processing, success, error and empty states; add skeletons to the data-heavy Overview and table screens. Verify every filter, tab and button is wired. Landing and in-app copy tightened to concrete supply-chain language, with no invented customers, logos or metrics.

## 9. Validation

Browser pass covering sign-in, CSV import with deliberately bad rows, demo dataset load, recommendation regeneration, SKU detail, and tenant isolation between two accounts; plus a typecheck.

## Technical notes

- Files touched: `domain/model.ts`, `data/repository.ts`, `engine/inventory-engine.ts`, `analytics/summary.ts`, `connectors/csv-connector.ts` and `types.ts`, `ionic.functions.ts`, the six authenticated routes, `index.tsx`, `app-shell.tsx`, `status-badge.tsx`, `styles.css`.
- One migration: `run_id` and `run_started_at` on `recommendations`.
- No new dependencies, no AI, no ERP connectors, no framework changes.
