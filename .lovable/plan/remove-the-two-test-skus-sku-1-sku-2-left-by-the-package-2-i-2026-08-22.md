# Remove the two test SKUs (SKU-1, SKU-2) left by the Package 2 import test

## Why they exist

During Package 2 verification a small test workbook (`demo.xlsx`, sheets "Products" and "Sales") was imported twice into this workspace on 2026-08-19. The deduplication worked as designed — the second import created no duplicate transactions — but the two products (`SKU-1` Hex Bolt, `SKU-2` Washer), their two `sales` rows and two `sales_transactions` rows remained in the database. The seeded demo dataset itself still has exactly 50 SKUs; these two rows are test residue, not part of it.

Verified current state:

- `products`: SKU-1, SKU-2 created 2026-08-19 21:18 (both from the test import).
- `sales`: 2 rows tied to those SKUs; `sales_transactions`: 2 rows.
- `import_batches`: 2 completed `demo.xlsx` batches (audit trail).

## Plan

1. One cleanup migration, scoped to the affected organisation and the two test SKUs only.
  Before deletion, assert that the affected organisation contains exactly the expected test records:
  - exactly 2 products with SKUs SKU-1 and SKU-2;
  - those products were created by the identified Package 2 test import;
  - only the expected 2 sales rows and 2 sales_transactions rows are associated with them.
  If the expected state does not match, abort the migration rather than performing a broader deletion. Do not use a broad condition such as "delete any product named SKU-1/SKU-2" across organisations.
  - Delete the 2 `sales` rows and 2 `sales_transactions` rows for SKU-1 / SKU-2.
  - Delete the 2 `products` rows (and any `inventory` rows for them, if present).
  - Keep the `import_batches` records — they are the audit trail of what was imported.
2. Verify afterwards: product count returns to 50, demand-planning and inventory workspaces render unchanged, and `sales` totals reflect only demo data.

## Notes

- No code changes, no RLS changes, no other organisations touched.
- Deletion is done via migration because direct database access is read/insert only.