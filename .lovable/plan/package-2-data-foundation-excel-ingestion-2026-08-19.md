# Package 2 — Data Foundation & Excel Ingestion

Goal: one ingestion pipeline that accepts CSV and `.xlsx`, inspects a workbook before import, maps sheets and columns to canonical Ionic entities, validates deterministically, and commits tenant-scoped data. No planning UIs, no connectors, no forecasting.

## 1. One pipeline, two source adapters

```text
CSV ─┐                                   ┌─ Products
     ├→ Source Adapter → SheetTable[] →  ├─ Customers
XLSX ┘   (parse only)     mapping →      ├─ Sales/Transactions
                          validation →   ├─ Inventory
                          canonicalise → └─ Suppliers
```

- New neutral shape `SheetTable { sheetName, headers[], rows: string[][], rowCount }`.
- `csv-source.ts` produces one SheetTable; `xlsx-source.ts` produces one per sheet.
- All mapping, validation, dedup and canonicalisation live in shared modules (`mapping.ts`, `validate.ts`, `canonicalise.ts`). The existing CSV behaviour is preserved by routing today's alias table and row rules into those shared modules — no second business-logic path, no change to `CanonicalDataset` consumers.
- Existing single-file CSV upload keeps working exactly as today (auto-mapped, one-click).

## 2. Workbook inspection and mapping

Two-step flow, both server functions, org resolved server-side:

1. `inspectUpload` — parses the file transiently in memory, returns workbook name, sheets, headers, approximate row counts, a *confidence-scored guess* of each sheet's entity (from header signatures, e.g. `on_hand`+`sku` → Inventory) and a suggested column→canonical field map. Unclear sheets are returned as `unknown`, never guessed silently.
2. `importUpload` — takes the file plus the user-confirmed sheet/column mapping, re-validates it server-side, and commits.

Nothing is persisted between the two steps; the browser holds the file and resends it. Mapping aliases live in one extensible table so new naming conventions are additive.

## 3. Minimal UI (functional, not polished)

Extend the existing Data Sources page only: accept `.csv,.xlsx`, then show a preview panel — sheet list with detected entity (editable select), column mapping selects, record counts, and grouped errors/warnings — with Cancel / Import. Existing CSV drop path stays one-step.

## 4. Data model additions (additive only)

- `customers` (org-scoped: external_ref, name, segment) and `channels` (org-scoped code/name).
- `sales_transactions` — the new demand fact at day grain: org_id, product_id, occurred_on, quantity, value, unit_price, cogs, customer_id, channel_id, location_id, region/state, currency_code, original_amount, import_batch_id, source_row_hash.
- `import_batches` — org_id, source (csv/xlsx), filename, sheet summary, counts, status, created_by; gives every imported row provenance and makes re-import reversible.
- Currency: `currency_code` + original amount stored as supplied; reporting currency held on the org policy. No FX conversion, no rates.
- Geography reuses Package 1 `locations`; region/state resolve to a location row where provided.

**Compatibility:** `sales` (monthly) stays the read path for the engine and every current screen. Transaction imports also write/refresh the matching monthly `sales` aggregate rows, so recommendations are unchanged in behaviour. Nothing existing is renamed or dropped.

## 5. Validation

Deterministic checks, reported at workbook / sheet / row / field level with severity: missing required fields, unparseable dates, non-numeric or negative quantities, out-of-range magnitudes, malformed currency, unknown SKU/supplier/location references, and duplicate keys within the file. Rows are rejected with a reason; nothing is invented or defaulted into existence. A partial dataset (inventory but no transactions) imports successfully and the result reports capability gaps, e.g. "Demand planning limited until transaction data is connected".

## 6. Duplicates and re-import

- Products, suppliers, inventory, monthly sales: keep today's upsert-on-natural-key behaviour (idempotent re-upload, no duplicate rows).
- `sales_transactions`: dedup on a deterministic key of (org, product, date, customer, channel, location, quantity, value) hashed into `source_row_hash`, unique per org. Where a source provides a real document/line reference we use that instead.
- Limitation reported honestly: without a document/line ID, two genuinely identical same-day transactions collapse into one. The preview will state this, and the safest alternative — replace-by-batch for a given file/period — is offered as the import mode when the user knows the file is a full period extract.

## 7. Security and limits

No change to auth, RLS pattern, role checks or headers. New tables follow the established pattern exactly: GRANT to `authenticated`/`service_role` only, RLS on, SELECT via `is_org_member`, writes via membership (deletes owner/admin). `org_id` always derived server-side. Files are processed transiently in the worker — no storage bucket, no temp files, no persisted uploads.

Limits: `.xlsx` and `.csv` only, validated by extension **and** file signature (ZIP magic bytes for xlsx); hard cap 5 MB and a bounded cell/row count (50k rows, 20k SKUs, capped sheets), with malformed-archive errors surfaced as a clean import failure rather than a crash.

**Runtime limitation (explicit):** the app runs in a serverless worker with a bounded request body and CPU budget. Workbooks above roughly 5 MB / ~50k rows cannot be processed synchronously and will be rejected with a clear message rather than half-imported. Larger volumes need background processing (storage upload + queued job), which is out of scope here and recommended as a later package.

## Technical notes

- xlsx parsing: a pure-JS, worker-safe SheetJS build (`@e965/xlsx`, the maintained fork on npm, no native deps, no filesystem). Parsed with formulas ignored and cell values read as text/dates only — no formula evaluation, no external link following.
- New files: `src/lib/ingestion/{sheet-table.ts,csv-source.ts,xlsx-source.ts,mapping.ts,validate.ts,canonicalise.ts,inspect.ts}`; changed: `src/lib/connectors/csv-connector.ts` (delegates to shared modules), `src/lib/domain/model.ts` (customer/channel/transaction types), `src/lib/data/repository.ts` (batch + transaction persistence), `src/lib/ionic.functions.ts` (`inspectUpload`, `importUpload`), `src/routes/_authenticated/data-sources.tsx` (preview step).
- Verification after implementation: typecheck, lint, production build, existing CSV re-import, single-sheet and multi-sheet workbook import, corrupt/oversized file rejection, duplicate re-import, and a cross-tenant read/write attempt against the new tables. Anything not actually run will be stated as not run.

## Out of scope

Demand/Supply/Distribution/Scenario UIs, Plan vs Actual, PO inbox, ERP/POS/e-commerce/API connectors, live FX or tariffs, forecasting, agentic intelligence, background job infrastructure.
