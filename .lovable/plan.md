# Ionic — Intelligent Ingestion & ETL Layer

## What exists today (verified by inspection)

One pipeline already has the right bones; the gap is that its understanding is shallow and the UI delegates every decision to the user:

- `sheet-table.ts` — neutral `SheetTable`, size guard rails. Good, unchanged.
- `csv-source.ts` / `xlsx-source.ts` — pure, worker-safe parsers → `SheetTable[]`. Unchanged.
- `mapping.ts` — `FIELD_ALIASES` (header-name synonyms), `ENTITY_DEFINITIONS` (10 kinds with required/optional fields), `suggestSheet()` scores **header names only**; confidence is zero unless every required field is matched. No value analysis, no cross-sheet awareness.
- `inspect.ts` — per-sheet suggestion → preview DTO.
- `canonicalise.ts` / `validate.ts` — deterministic validation, date/number/currency parsing, row hashing, issue log. Solid; extended, not replaced.
- `ionic.functions.ts` — `inspectUpload` / `importUpload` two-step commit with server-side re-validation, batch creation, lifecycle compatibility.
- `import-wizard.tsx` — renders a full configuration panel **per sheet** (entity select + per-field mapping selects). This is the cognitive-load problem.

Design rule for everything below: deterministic, rule-based inference only — no AI calls, no new pipeline, no schema changes. The existing modules are extended; the import lifecycle from the previous task is untouched.

## 1. Column profiling — `ingestion/profile.ts` (new)

Pure functions that profile every column of every sheet before any mapping decision: inferred type mix (date / number / identifier-like text / free text / boolean), null rate, unique-value ratio, and up to N sample values. Value-pattern signals recognise identifiers (`CUS-001` vs `SKU-1001` style prefixes), currency-prefixed numbers, and date formats actually present. This is the "use data, not just headers" input.

## 2. Semantic mapping upgrade — extend `mapping.ts`

- Substantially expand `FIELD_ALIASES` (Stock Code, Item No, Client, Account, Buyer, Units, Volume, Closing Balance, etc.).
- Column→field scoring becomes multi-signal: header alias (exact > normalized > partial), type compatibility from the profile (a `quantity` candidate must be numeric; `transaction_date` must parse as dates), and value-pattern affinity (identifier prefix agreement). Every mapping carries a confidence: **high / medium / low / unresolved**.

## 3. Sheet classification — `ingestion/classify.ts` (new)

Classifies each sheet on multiple signals, never the sheet name alone: header-alias scores (existing), column-type signatures (date+quantity+price ⇒ transactional; month-grain date+quantity ⇒ aggregate demand; mostly text, few rows, no measures ⇒ contextual), value patterns, and row/column shape. Each sheet gets:

- an entity kind from the **existing** 10 kinds (no new canonical entities),
- a data role tag: master / transactional / aggregate / contextual,
- a confidence category,
- a plain-language reason ("looks like sales transactions: invoice date + customer + item + quantity").

Contextual sheets (company info, notes, contacts) classify as `ignored` with a stated reason — visible, never silently dropped. Analytical sheets like `Month | SKU | Region | Units Sold` classify as `sales_monthly` (aggregate role) instead of falling through to unknown.

## 4. Cross-sheet relationships — `ingestion/relationships.ts` (new)

After per-sheet mapping, value-set overlap analysis links identifier columns across sheets: `Sales."Customer Code" ⊆ Customers."Customer Code"` confirms both the sheet class and the column meaning — this resolves ambiguous columns like a bare "Code". Two uses:

- **Confidence boosting:** a column whose values match a master sheet's key is confirmed as that foreign reference.
- **Overlap detection:** if a transaction-level sheet and a monthly-aggregate sheet cover the same SKU-months, flag the overlap. Default: import the transaction-level source (day grain is strictly richer and feeds the monthly aggregate), mark the aggregate sheet as *review — overlaps with Sales* and skip it unless the user includes it. No silent double-counting; the choice is surfaced, not hidden.

## 5. Auto-import decision — folded into `classify.ts`/`inspect.ts`

Per sheet: **high** confidence → auto-import (pre-approved plan); **medium** → imported but listed under warnings; **low/unknown** → skipped pending review, with the full override UI. `inspectUpload` returns the workbook-level summary (`12 sheets · 9 ready · 2 warnings · 1 needs review`), per-sheet confidence/role/reasons, relationships found, and overlap flags. `importUpload` is unchanged in contract — it still receives explicit plans and re-validates everything server-side; the wizard simply stops forcing the user to author plans by hand.

## 6. Normalization hardening — extend `validate.ts`

- Missing-value tokens (`N/A`, `-`, `unknown`, `n.a.`, blank) parse as *missing*, never zero, for numeric/date fields.
- Add explicit `23-Aug-26`-style day-first written dates (deterministic, no engine sniffing); existing ISO / `dd/mm/yyyy` / Excel-serial paths unchanged.
- Currency-prefixed numbers (`₦1,250`, `AED 4,500`) already parse; covered by new tests.

## 7. Exception-based UI — rework `import-wizard.tsx`

Flow becomes: **upload → "We found N sheets" → summary → Import / review exceptions.**

- Header summary card: sheets found, ready / warnings / needs review counts, and the business preview (Products 1,240 · Customers 482 · Sales 18,421 transactions · …).
- **Ready sheets**: collapsed rows — name, detected entity, record count, confidence pill; expandable to override entity or any column mapping (existing controls reused).
- **Warnings / needs-review sheets**: expanded by default with the reason and the existing mapping controls.
- One `Import N sheets` button; no per-sheet approval. Overrides always possible (AI-assisted, not AI-locked).
- Post-import report extended: per-entity record counts, per-sheet disposition (imported / skipped / needs review), warnings grouped, mapping-confidence breakdown.

CSV uses the identical path (one sheet through the same classifier); high-confidence CSVs stay effectively one-click.

## 8. Provenance & lifecycle — no regression

No schema changes: `import_batches.sheet_summary` (jsonb) gains per-sheet `confidence`, `role`, and `disposition` entries — batch-level provenance plus existing transaction/PO `import_batch_id` attribution stays the source of truth. One workbook = one batch; the Imported Files lifecycle (Active → Inactive → Deleted), inactive-batch planning exclusion, monthly recomputation, role checks, RLS, and audit events all keep working. Shared master data remains workspace-level (known, documented limitation — unchanged).

## Files

- **New:** `ingestion/profile.ts`, `ingestion/classify.ts`, `ingestion/relationships.ts`, `ingestion/etl.test.ts` (+ fixtures).
- **Changed:** `ingestion/mapping.ts` (aliases, confidence, value-aware scoring), `ingestion/validate.ts` (missing tokens, written dates), `ingestion/inspect.ts` (rich inspection DTO), `ionic.functions.ts` (DTO passthrough only), `import-wizard.tsx` (exception UX), `data-sources.tsx` (minor: report display).
- **Not touched:** parsers, `canonicalise.ts` row rules, repository persistence, lifecycle functions, RLS, routes.

## Verification

- Unit tests: profiling; classification fixtures (a sheet named "Data" with Invoice No / Customer Code / Item Code / Qty / Unit Price must classify as transactions; `Month|SKU|Units` as aggregate demand; "Company Info" as contextual-skip); relationship linking; overlap detection; normalization cases.
- Regression: build a synthetic 14-sheet workbook matching the structure you described (business info, customers, products, sales, monthly sales, POs, inventory, pricing, locations…) and assert the engine auto-maps the large majority with no manual configuration. **Your real demo workbook is not available in this session — please re-attach it when we verify, and it becomes the primary acceptance test.**
- End-to-end: upload → summary → import → Imported Files lifecycle (deactivate/reactivate/delete) still works; existing CSV one-click path unchanged; typecheck + full test suite + production build.
- Report afterwards: files changed, logic added, tests run, known limitations, deferred items — and an explanation of exactly how each sheet/column decision is made.
