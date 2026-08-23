# Ionic — Implement Import Lifecycle + Intelligent ETL Together

## IMPORTANT

I previously asked you to diagnose the **Import Lifecycle & Dataset Deletion Fix** and the **Intelligent Ingestion & ETL Layer** separately.

The Import Lifecycle plan was diagnosed correctly but was **not previously approved/implemented**.

The Intelligent ETL plan has also been inspected/planned but has not yet been fully implemented.

I now want these two plans implemented together because they are complementary parts of Ionic's data ingestion architecture.

However, implement them in the explicit phases below.

---

# PHASE 0 — RECONCILE CURRENT STATE

Before making changes, inspect the live/current repository and database.

Determine exactly which parts of either plan have already been implemented.

Do NOT assume either plan is completely unimplemented.

Check:

### Import lifecycle

- `import_batches`
- batch status
- RLS policies
- UPDATE permissions
- repository lifecycle functions
- server lifecycle functions
- Imported Files UI
- audit events
- inactive-batch filtering
- monthly sales recomputation
- batch deletion

### Database integrity

Inspect the current composite foreign keys and confirm whether the previously identified defect still exists:

```text
purchase_orders_org_product_fkey
purchase_orders_org_supplier_fkey
purchase_orders_org_location_fkey
purchase_orders_org_batch_fk
sales_tx_org_customer_fkey
sales_tx_org_channel_fkey
sales_tx_org_location_fkey
sales_tx_org_batch_fkey
inventory_org_location_fkey

```

Confirm whether they still use broad:

```text
ON DELETE SET NULL

```

behaviour that can null `org_id`.

### ETL

Inspect:

- `sheet-table.ts`
- `csv-source.ts`
- `xlsx-source.ts`
- `mapping.ts`
- `inspect.ts`
- `canonicalise.ts`
- `validate.ts`
- `ionic.functions.ts`
- `import-wizard.tsx`
- `data-sources.tsx`

Also inspect any ETL files already created from the previous planning request.

Do not duplicate existing work.

---

# PHASE 1 — FIX DATABASE INTEGRITY + IMPORT LIFECYCLE

Implement the previously diagnosed Import Lifecycle & Dataset Deletion Fix if it has not already been implemented.

## 1. Fix composite FK defect

The confirmed root cause of the original error:

```text
null value in column "org_id" of relation "purchase_orders" violates not-null constraint

```

is the composite tenant-isolation foreign key pattern:

```text
purchase_orders (org_id, product_id)
REFERENCES products (org_id, id)
ON DELETE SET NULL

```

PostgreSQL can null the entire referencing key, including `org_id`, which conflicts with:

```text
purchase_orders.org_id NOT NULL

```

Recreate the affected composite FKs using column-specific referential actions where appropriate.

For example:

```text
ON DELETE SET NULL (product_id)

```

so that only the business reference is cleared.

`org_id` must never become nullable.

Preserve:

- NOT NULL constraints
- tenant isolation
- RLS
- authentication
- server-side org derivation
- role checks

Do not weaken security to fix the error.

---

# 2. Fix `clearWorkspaceData`

Correct the workspace deletion dependency order.

The intended order is:

```text
recommendations
purchase_orders
sales_transactions
sales
inventory
products
suppliers
customers
channels
locations
data_sources

```

Keep `import_batches` metadata for audit where appropriate.

The original workspace-delete operation that produced the `org_id` error must succeed after the fix.

---

# 3. Import Lifecycle

Implement/retain:

```text
ACTIVE
  ↓
INACTIVE
  ↓
DELETED

```

with reactivation:

```text
INACTIVE
  ↓
ACTIVE

```

Use the existing status conventions where possible:

```text
completed / active = Active
inactive = Inactive
deleted = Soft deleted

```

Do not introduce a second status model if one already exists.

---

# 4. Lifecycle permissions

Any authenticated member may view imports.

Only owner/admin roles may:

- deactivate
- reactivate
- delete

Enforce this both:

- server-side
- through RLS/policies

Do not expose service-role credentials to the client.

---

# 5. Deactivation

When a batch becomes inactive:

- transactions remain stored
- PO rows remain stored
- data is excluded from active planning
- demand calculations exclude it
- supply calculations exclude it
- recommendations exclude it
- monthly aggregates are recomputed
- audit event is recorded

Do not physically delete records.

---

# 6. Reactivation

When reactivated:

- status returns to active/completed
- affected monthly aggregates are recomputed
- recommendations regenerate
- data becomes active again
- no duplicate records are created
- audit event is recorded

---

# 7. Permanent deletion

Only inactive batches may be deleted.

Server-side enforcement must reject deletion of an active batch.

Deletion should:

- remove batch-attributed transaction records
- remove batch-attributed PO records
- rebuild affected monthly aggregates
- regenerate recommendations
- mark the import batch `deleted`
- preserve batch metadata/audit information
- record an audit event

The batch should be hidden from the normal active/import UI after deletion.

---

# 8. Known shared-data limitation

Preserve the existing architecture:

Currently:

```text
batch-attributed:
sales_transactions
purchase_orders

```

Shared workspace-level:

```text
products
suppliers
customers
channels
locations
inventory

```

Do NOT perform a broad master-data redesign as part of this task.

The UI should clearly explain that deactivating/deleting an import does not rewind shared master data or inventory snapshots.

---

# PHASE 2 — INTELLIGENT INGESTION / ETL

After Phase 1 is correctly implemented, implement the Intelligent Ingestion & ETL layer.

The goal:

> A business user can upload a messy multi-sheet Excel workbook and Ionic automatically understands and imports the useful business information with minimal manual intervention.

---

# 9. Preserve the existing ingestion pipeline

Do not create a second ingestion pipeline.

Extend the existing:

```text
SheetTable
↓
CSV/XLSX parser
↓
mapping
↓
inspect
↓
canonicalise
↓
validate
↓
ionic.functions
↓
import wizard

```

architecture.

The existing deterministic parser/validation architecture is good.

The gap is intelligence and UX, not the need for an entirely new pipeline.

---

# 10. Column profiling

Add the proposed profiling layer.

Profile:

- inferred data types
- null rate
- unique-value ratio
- identifier patterns
- date patterns
- currency patterns
- sample values
- numeric/text characteristics

Use actual values, not only column names.

---

# 11. Semantic mapping

Extend field aliases and mapping to use:

- exact header matches
- normalized matches
- partial matches
- type compatibility
- value patterns
- identifier patterns
- cross-sheet relationships

Examples:

```text
SKU
SKU Code
Product Code
Item Code
Stock Code

```

should be candidates for the same canonical SKU field.

Similarly:

```text
Customer
Client
Account
Buyer

```

and:

```text
Qty
Quantity
Units
Units Sold
Volume

```

---

# 12. Sheet classification

Automatically classify sheets using:

- sheet name
- headers
- column types
- values
- row/column shape
- identifier patterns
- cross-sheet relationships

Possible existing entity types should be reused.

Do not create unnecessary new canonical entities.

Each sheet should receive:

- detected entity
- data role
- confidence
- plain-language explanation

For example:

> "Looks like sales transactions because it contains invoice dates, customer identifiers, product identifiers, quantity and unit price."

---

# 13. Cross-sheet relationships

Detect relationships such as:

```text
Sales.Customer Code
        ↓
Customers.Customer Code

Sales.Product Code
        ↓
Products.Product Code

```

Use value-set overlap and other deterministic signals to improve confidence.

Also detect overlapping datasets.

For example:

```text
Sales transactions

```

and:

```text
Monthly Sales

```

covering the same SKU/month combinations.

Do not silently double-count them.

---

# 14. Confidence-based import

Use:

```text
HIGH
MEDIUM
LOW / UNRESOLVED

```

with these rules:

### HIGH

Automatically import.

### MEDIUM

**Require review before importing.**

Do NOT silently commit medium-confidence mappings.

### LOW / UNRESOLVED

Do not import until explicitly resolved.

### USER OVERRIDE

Allow the user to explicitly override Ionic's recommendation.

The system should be AI-assisted/deterministic-assisted, but never AI-locked.

---

# 15. Exception-based UX

Replace the current per-sheet approval experience.

Instead of:

```text
Configure Sheet 1
Configure Sheet 2
Configure Sheet 3
...

```

use:

```text
12 sheets detected

9 ready
2 need review
1 unresolved

```

High-confidence sheets should be collapsed and effectively pre-approved.

Warnings and unresolved sheets should be surfaced for review.

The main path should be:

```text
Upload
↓
Analyze
↓
Review exceptions if needed
↓
Import

```

---

# 16. Business preview

Show a concise preview such as:

```text
Products          1,240
Customers           482
Sales            18,421
Purchase Orders     642
Inventory         1,240
Locations            14
Historical Demand   36 months

```

Use the existing Ionic visual language.

---

# 17. Quantitative sheets

Recognize useful analytical/aggregate sheets such as:

- Monthly Sales
- Historical Demand
- Regional Performance
- SKU Movement
- Annual Revenue
- Sales by Customer
- Sales by Product

Do not discard useful quantitative information merely because it is not a conventional master table.

At the same time, prevent double-counting where aggregate data overlaps richer transaction-level data.

---

# 18. Normalization

Extend deterministic normalization for:

- dates
- numeric values
- currency-prefixed numbers
- missing-value tokens
- common spreadsheet formatting differences

Missing values must never automatically become zero.

---

# 19. Data quality report

After import, provide:

- records imported
- sheets imported
- sheets skipped
- sheets requiring review
- warnings
- mapping confidence
- important data-quality issues

The user should understand what Ionic did without needing to understand ETL terminology.

---

# 20. Provenance

Preserve the existing import-batch model.

One workbook = one import batch.

`import_batches.sheet_summary` can contain:

- sheet
- detected entity
- role
- confidence
- disposition
- relevant warnings

Existing `import_batch_id` attribution for transactions and purchase orders remains the source of truth for lifecycle deletion.

Do not redesign all master-data tables in this task.

---

# PHASE 3 — INTEGRATED TESTING

Test the two systems together.

## Test A — Excel ingestion

Use a representative multi-sheet workbook containing:

- business information
- customers
- products
- suppliers
- sales
- purchase orders
- inventory
- locations
- pricing
- historical/quantitative data
- monthly sales or similar aggregate data

Verify that Ionic automatically understands the majority of useful sheets without manual configuration.

---

## Test B — Confidence

Verify:

```text
High → automatically imported
Medium → review required
Low → unresolved

```

No uncertain mapping should silently enter the canonical model.

---

## Test C — Import lifecycle

Verify:

```text
Import
↓
Active
↓
Deactivate
↓
Planning numbers change appropriately
↓
Reactivate
↓
Planning numbers restore
↓
Deactivate
↓
Delete

```

Verify:

- transactions removed
- PO rows removed
- import metadata retained
- unrelated imports untouched
- no duplicate records

---

## Test D — Original deletion bug

Re-run the workspace deletion flow that originally generated:

```text
null value in column "org_id" of relation "purchase_orders" violates not-null constraint

```

It must now complete successfully.

---

## Test E — Security

Verify:

- org isolation remains intact
- owner/admin restrictions remain intact
- members cannot mutate lifecycle state
- RLS remains enabled
- `org_id` remains NOT NULL
- service-role credentials are not exposed

---

# PHASE 4 — REAL WORKBOOK ACCEPTANCE TEST

The synthetic workbook is useful for automated tests.

However, the real multi-sheet Excel workbook I previously uploaded is the primary acceptance test because it contains the actual business-data structure that exposed the ingestion limitations.

I will re-attach the real workbook after implementation.

Do not claim the real-world ETL requirement is verified until that workbook has been tested.

---

# IMPLEMENTATION DISCIPLINE

Before making changes:

1. Inspect the current state.
2. Reuse anything already implemented.
3. Apply database integrity fixes first.
4. Implement lifecycle.
5. Implement ETL intelligence.
6. Run tests.
7. Run build/typecheck.
8. Run lifecycle smoke tests.
9. Report anything not tested.

Do not:

- create duplicate import systems
- create duplicate lifecycle systems
- weaken RLS
- make `org_id` nullable
- expose service-role credentials
- perform broad master-data redesign
- rewrite unrelated Ionic functionality

---

# FINAL REPORT

When finished, report:

1. What was already implemented.
2. What was missing.
3. Database migrations applied.
4. Files changed.
5. Import lifecycle functionality implemented.
6. ETL functionality implemented.
7. Tests run.
8. Build/typecheck results.
9. Smoke-test results.
10. Known limitations.
11. Deferred architectural improvements.

Do not claim a feature or test is complete unless it was actually implemented and verified.