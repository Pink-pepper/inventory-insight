# Import Lifecycle & Dataset Deletion Fix

## Diagnosis — root cause confirmed against the live database

The error `null value in column "org_id" of relation "purchase_orders" violates not-null constraint` is **not** an application insert bug. It is a schema defect:

- The tenant-isolation foreign keys added during the security hardening passes are **composite** keys, e.g. `purchase_orders (org_id, product_id) REFERENCES products (org_id, id) ON DELETE SET NULL`.
- Postgres' `SET NULL` on a composite key nulls **all** referencing columns — including `org_id`, which is `NOT NULL`. So deleting any product, supplier or location that a purchase order references fails with exactly the reported error.
- Trigger path: the workspace delete in Settings (`clearWorkspaceData`) removes products/suppliers while imported purchase orders still exist. Your Excel demo dataset contained PO lines, so the delete blew up. The same landmine sits on `sales_transactions` (customer/channel/location/batch) and `inventory` (location).

Verified via `pg_constraint`: `purchase_orders_org_product_fkey`, `purchase_orders_org_supplier_fkey`, `purchase_orders_org_location_fkey`, `purchase_orders_org_batch_fk` (NO ACTION), `sales_tx_org_customer_fkey`, `sales_tx_org_channel_fkey`, `sales_tx_org_location_fkey`, `sales_tx_org_batch_fkey`, `inventory_org_location_fkey` — all composite with plain `SET NULL`.

Secondary gap: `import_batches` exists (default status `completed`, 3 batches present) with only read/insert policies — there is no lifecycle, no per-import delete, and no UI for it. Only `sales_transactions` and `purchase_orders` carry `import_batch_id`; products, suppliers, customers, channels, locations and inventory are shared, non-batch-attributed entities.

## 1. Migration — fix the FK defect, enable the lifecycle

- Recreate the nine composite FKs with a column-list action, e.g. `ON DELETE SET NULL (product_id)` — only the business reference is cleared, `org_id` is never touched. This is a **strengthening** of integrity: tenant isolation, RLS and NOT NULL constraints are untouched.
- `purchase_orders_org_batch_fk` moves from NO ACTION to `SET NULL (import_batch_id)`, matching its single-column twin.
- `GRANT UPDATE (status) ON public.import_batches TO authenticated` plus an UPDATE policy restricted to owners/admins (`has_org_role`). Status is the only mutable column; there is still **no** delete policy — batches are soft-deleted, preserving the audit trail.

## 2. Fix `clearWorkspaceData` (immediate bug)

Delete in dependency order and cover the whole workspace: recommendations → purchase_orders → sales_transactions → sales → inventory → products → suppliers → customers → channels → locations → data_sources. `import_batches` rows are kept (audit trail); the audit event records the scope. Role gate (owner/admin) unchanged.

## 3. Import lifecycle — repository layer (`src/lib/data/repository.ts`)

- `inactiveBatchIds()` — ids of batches with status `inactive`.
- `loadDemandFacts()` / `loadOpenSupply()` — exclude rows from inactive batches, so deactivated data stops influencing demand, supply, distribution and recommendations. Monthly `sales` rows are handled by recomputation (below), so no filter needed there.
- `refreshMonthlySales()` — gains an optional excluded-batch filter so recomputation ignores inactive batches.
- `rebuildMonthlyFromTransactions()` — for the products/months a batch touched: delete those monthly rows, then re-derive them from remaining active transactions. This exactly mirrors existing import semantics (transactions are the source of truth for months they touch).
- `listImportBatches()` — batches with status, row counts and per-batch transaction/PO counts for the UI.
- `setImportBatchStatus()` — org-scoped status transition; a foreign batch id is a no-op.
- `deleteBatchRows()` — removes the batch's transactions and PO lines, returns counts.

## 4. Server functions (`src/lib/ionic.functions.ts`)

- `getImportBatches` (any member) — list with lifecycle state.
- `setImportBatchActive` (owner/admin) — deactivate: status → `inactive`, rebuild monthly aggregates for affected products, regenerate recommendations, audit `import.deactivated`. Reactivate: status → `completed`, same recomputation, audit `import.reactivated`. Transaction rows are never physically touched by either.
- `deleteImportBatch` (owner/admin) — **server-enforced: only `inactive` batches can be deleted.** Deletes the batch's transaction and PO rows, rebuilds monthly aggregates, regenerates recommendations, sets status → `deleted` (soft delete — metadata retained), audits `import.deleted` with counts.

Status model: `completed`/`active` = Active, `inactive` = Inactive, `deleted` = soft-deleted (hidden from UI, retained for audit).

## 5. Data Sources UI (`src/routes/_authenticated/data-sources.tsx`)

New "Imported files" panel listing each batch: filename, format, import date, rows accepted/rejected, transaction and PO counts, and a status pill (Active / Inactive). Owners/admins get per-row actions, each with an inline confirm:

- **Deactivate** (active only) — copy explains data is excluded from all planning, not deleted.
- **Reactivate** (inactive only).
- **Delete permanently** (inactive only) — copy explains transaction and PO rows are removed, shared entities (products, suppliers, customers, channels, locations) are preserved, and the import record is kept for audit.

Members see the list read-only. All actions invalidate queries so planning views refresh.

## 6. Stated limitation (shown in the UI, not hidden)

Inventory snapshots (`inventory` rows) and shared master data are **not batch-attributed** — an import upserts them at workspace level, so deactivating or deleting a batch cannot rewind stock-on-hand or remove products/suppliers the file introduced. The delete/deactivate dialogs will say this plainly. Attributing inventory and master data per batch is possible later (add `import_batch_id` to those tables) but is out of scope for this fix.

## Security notes

- No change to authentication, RLS posture, or tenant isolation — the migration tightens a defective constraint and adds one owner/admin-scoped update policy.
- `org_id` is always derived server-side; every mutation is double org-scoped; role checks happen in the server function **and** in RLS.
- Batches can never be hard-deleted through the API (no delete policy exists).

## Verification

Typecheck, existing unit tests, production build; then a live smoke test in the preview: deactivate a batch (planning numbers change, transactions retained), reactivate (numbers restored), attempt delete on an active batch (refused), delete an inactive batch (rows gone, batch record retained), and re-run the workspace delete that originally failed. Anything not run will be stated as not run.
