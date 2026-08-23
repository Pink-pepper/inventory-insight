# Workstream 6.5 — Semantic Data & Inventory Movement Foundation

Architecture and discovery proposal only. No code, migrations, or behavioural changes in this task. All findings below were verified against the current codebase (file:line references in the technical notes).

## 1. Current-state audit

The Package 2 pipeline is sound and worth preserving: source adapter → neutral `SheetTable` → value-based column profiling → grain/orientation inference → multi-signal classification → validation → canonicalisation → tenant-scoped persistence with provenance. Nothing downstream knows about CSV/Excel.

Already working well:
- **Structure-driven classification** — sheet and file names are never used; columns are typed by value shape, then scored against alias tables with arbitration passes for ambiguity and duplicates.
- **Five-stage lifecycle exists informally** — `auto / review / blocked / unsupported / ignored` dispositions map closely onto Unknown → Recognised → (Stored) → Canonicalised → Planning-enabled, but only the first four stages are explicit; "planning-enabled" is implicit and undocumented per dataset.
- **Provenance on day-grain facts** — `sales_transactions`, `purchase_orders`, `demand_forecasts` carry `source_row_hash` + `import_batch_id` + `source_ref`; batch lifecycle (active/inactive/deleted) with aggregate rebuild works.
- **Honesty rules** — no invented values, no formula evaluation, blocked sheets fail loudly, forecasts stored but deliberately unconsumed (tracked follow-up), movement sheets surfaced with plain-language explanations rather than silently dropped.

## 2. Semantic ingestion assessment — where it breaks down

1. **Sales vs movement boundary is the main systemic risk** (`classify.ts:473-517`). Movement wins only with (a) zero commercial columns AND (b) a movement-word header (`received|issued|adjust|consum|usage|…`) or ≥5% negative quantities. A consumption log headed "Qty" with all-positive quantities and no price/customer columns classifies as **sales transactions** — the exact "Consumption → Monthly Sales History" misclassification the workstream names. Only one vocabulary-explicit test case pins this behaviour.
2. **Recognised-but-unstorable data is lost after the session.** `inventory_movement`, `planning_policy` (beyond accepted org-scope proposals), `documentation`, and `unsupported` sheets leave no database trace — the classification exists only in the transient inspection response.
3. **Snapshot drift** — a growing daily stock-count log has many distinct dates, so grain inference grades it `periodic/transaction`, not `snapshot`, making it eligible to win the `transactions` scoring race (`grain.ts:130-161`).
4. **Alias-table brittleness** — static hand-maintained dictionaries; unknown abbreviations/non-English headers fall back to weak value-type signals. A second smaller alias list in `csv-connector.ts` can drift from `mapping.ts`.
5. **Within-import silent overwrite** — inventory and forecast keys are last-write-wins with no warning; two same-key rows in one workbook lose data silently.

## 3. Inventory movement architecture (recommended)

New canonical domain `CanonicalMovement` + table `inventory_movements`, additive, following the established `sales_transactions` pattern exactly (GRANTs, RLS via `is_org_member`, composite FKs):

```text
inventory_movements
  org_id, product_id, occurred_on, quantity (signed)
  movement_class  enum: sale | consumption | sampling | promotional
                    | service_use | damage | expiry | quality_loss
                    | return | adjustment | transfer | assembly | other
  source_reason   text (verbatim reason from source, never normalised away)
  location_id, source_ref, value, currency_code, original_amount, cogs
  source_row_hash (unique per org), import_batch_id, created_at
```

Design rules:
- **Movement semantics are declarative, not hard-coded.** A small in-code registry maps each `movement_class` to capability flags: `{ affectsInventory, countsAsDemand, countsAsRevenue, countsAsCogs }`. Sampling = inventory↓, demand no, revenue no. Sale = all four. Consumption = inventory↓, demand *configurable later*. Engines read these flags only when a future package wires them in — storing movements changes nothing in Packages 1–6.
- **A $0 value is valid** and distinct from NULL (value not supplied). Validation keeps that distinction; aggregation code must treat NULL as "unknown" and 0 as "genuinely zero".
- **Direction derives from signed quantity + class**, never from a user-supplied sign convention.
- **Classifier promotion**: extend the movement evidence rule beyond header vocabulary — sheet name context, a matched `movement_type`/`reason` column with movement-like *values* (value-scan of a type column, not just header words), and signed quantities remain signals. A sheet that still only looks like "SKU/date/positive qty" stays sales but carries an explicit assumption note in the UI ("treated as customer sales").

## 4. Recognition vs storage vs planning capability

Recommended smallest architecture — make the five stages explicit metadata, not new infrastructure:

- Extend each `EntityDefinition` with a `capability` descriptor: `{ stored: boolean, planningConsumers: string[] }`. This one structure drives both the UI copy and honest "what Ionic will do with it" messaging. No engine change.
- For recognised domains Ionic cannot yet use (supplier performance, pricing, marketing, external forecasts beyond demand, logistics): **do not create per-domain tables speculatively and do not create an EAV/generic column store.** Instead one bounded archive table, only if the product decision below is approved:

```text
preserved_datasets
  org_id, import_batch_id, sheet_name, recognised_kind text,
  headers jsonb, rows jsonb (bounded, e.g. 50k cells),
  row_count, created_at
```

  This preserves information with full provenance, is never read by any engine, and gives future packages real customer data to design against. It is deliberately not queryable as facts — it is a vault, not a schema.

## 5. Ingestion UX recommendations

Keep the current review structure; change the communication layer:

1. Per-sheet capability badge driven by the `capability` descriptor: **"Feeds planning"** / **"Stored as record"** / **"Recognised — preserved, not used yet"** / **"Not understood — needs your confirmation"**. This replaces today's implicit "Recognised, not stored" with an explicit statement of consequence.
2. Assumption surfacing: when a SKU/date/qty sheet is accepted as sales without commercial evidence, show "Ionic is treating these as customer sales" with a one-click reclassify to movement. This is the exception-escalation point for the §2.1 risk.
3. Within-import overwrite (§2.5) becomes a visible warning, not silent.
4. No change to the manual-mapping fallback — it stays as the escalation path, but relationship-completed mappings and high-confidence sheets remain auto. The user never sees canonical field names unless they open the override.

## 6. Planning-engine audit — incorrect / ambiguous / incomplete dependencies

Verified findings (do not fix in this workstream; feed the upcoming planning-engine audit):

1. **Sales is the only demand signal everywhere** — inventory engine (`averageMonthlyDemand` from monthly `sales`), demand baseline (trailing average), supply plan (re-derives the same baseline), distribution (transaction-level rates). There is no consumption concept distinct from sales.
2. **Zero-value rows distort both sides** — a $0 sample/return row contributes full quantity to demand and a real 0 to revenue totals, diluting implied average price. No module flags or excludes zero-value rows.
3. **Inventory is snapshot-only** — upsert overwrites `on_hand` per (product, location); no ledger exists, so no reconciliation of balance changes against sales, receipts, or adjustments is possible.
4. **Dual write-path into `sales`** — direct monthly upload and transaction-rebuilt aggregates are indistinguishable downstream (structurally safe today via richer-wins + rebuild, but unlabelled).
5. **`demand_forecasts` written, never read** — confirmed; `demand/baseline.ts` header documents this as the tracked follow-up. Precedence vs trailing-average baseline is undefined by current code.
6. **No COGS or margin is computed anywhere** — `analytics/summary.ts` uses engine output only (inventory value, excess value, purchase requirement); revenue appears once as a display-only demand-workspace total. Defensible today: units-based demand, inventory value at cost, purchase requirement, procurement spend from POs. **Not defensible yet**: gross margin, revenue analytics, plan-vs-actual financials, multi-currency anything (currency stored verbatim, no reporting currency, no conversion).
7. **Distribution demand is transactions-only** — monthly-only tenants get no location-level distribution insight (documented, correct, but a capability gap to communicate).

## 7. Canonical data model changes (additive only)

1. `inventory_movements` table + `CanonicalMovement` type + `movement_class` enum (§3).
2. Provenance backfill: add nullable `import_batch_id` + `source_ref` to `inventory` and `sales` (nullable, no backfill inference — old rows simply have unknown origin, stated honestly).
3. Optional `preserved_datasets` archive (§4, pending product decision).
4. `capability` descriptors in `EntityDefinition` — code metadata, not a schema change.

Nothing is renamed, dropped, or re-keyed.

## 8. Provenance and source-of-truth model

Authority order per domain, to be codified as documented precedence rules (most already hold structurally):

- **Demand facts**: transaction-grain beats monthly aggregate for the same SKU-month (already enforced: richer-sheet-wins at classification, monthly rebuild at persistence). Direct monthly upload is authoritative only where no transactions exist.
- **Inventory position**: newest snapshot per location wins (current behaviour); once movements exist, a later reconciliation package can flag snapshot-vs-ledger drift — snapshots remain authoritative.
- **Purchase orders**: business-identity fingerprint (PO ref + SKU + supplier) is the identity; mutable fields update in place.
- **Forecasts**: SKU + period + location + method fingerprint; a customer-supplied forecast and a future Ionic-generated forecast are distinct methods, never merged.
- Every stored row traces to a batch; every batch to a file, sheet map, and user.

## 9. Capability-gap model

One vocabulary everywhere (UI, docs, audit log):

| Stage | Meaning | Example today |
|---|---|---|
| Unknown | Cannot classify confidently | Unrecognised sheet |
| Recognised | Business meaning understood | Consumption log |
| Stored | Safely persisted with provenance | (needs §3/§4) |
| Canonicalised | Mapped into a canonical domain | Sales transactions |
| Planning-enabled | An engine is validated to consume it | Monthly sales → engine |

Recognition never implies planning eligibility; lack of planning support never implies discard. The `capability` descriptor (§4) is the single source of truth the UI renders.

## 10. Migration / backward compatibility

- All changes additive; existing upsert keys, dedup hashes, batch lifecycle, and RLS patterns unchanged.
- Engines keep reading exactly the same tables; movements and the archive are write-only until a later, separately-approved package wires consumption rules in.
- Existing customer data untouched; new provenance columns nullable with no backfill.
- Each step ships behind the existing test suite plus new adversarial classification tests (generic-header consumption logs, snapshot drift, $0-value rows).

## 11. Recommended implementation sequence

- **6.5a — Capability metadata + UX honesty pass**: `capability` descriptors, per-sheet capability badges, assumption notes ("treated as customer sales"), within-import overwrite warnings, nullable provenance columns on `inventory`/`sales`. No behaviour change.
- **6.5b — Inventory movement domain**: `inventory_movements` table, canonical type, classifier promotion (value-scan movement evidence), persistence with dedup, import-wizard surfacing as "Stored as record". Engines untouched.
- **6.5c — Preservation vault** (if approved): `preserved_datasets` archive + UI state "Recognised — preserved, not used yet".
- **6.5d — Feeds the planning-engine audit** (separate, already-tracked): forecast consumption precedence, consumption-aware demand rules, movement-vs-snapshot reconciliation, zero-value handling. Not implemented here.

## 12. Explicitly outside scope

- AI / autonomous classification or learned aliases (deterministic signals only).
- FX conversion, reporting currency, tariffs — store verbatim, convert never (needs a dedicated finance package).
- Margin/COGS analytics, plan-vs-actual financials — blocked on movement + forecast consumption work.
- Per-domain tables for supplier performance, pricing, marketing — deferred until real preserved datasets justify a schema.
- Any change to Packages 1–6 engine behaviour.

## Implementation Readiness

- **Ready to implement**: 6.5a in full; 6.5b schema/persistence/classifier-promotion mechanics.
- **Needs product decision**: (1) the `preserved_datasets` vault (6.5c) — storing data no feature uses has real value for learning customer shapes but adds storage and a privacy surface to disclose; (2) whether misclassification-risk sheets (SKU/date/qty, no commercial evidence) should default to *review* instead of auto-accept as sales — safer, but adds friction to the most common happy path.
- **Needs data/model decision**: the `movement_class` enum list — the §3 set is a proposal; the per-class capability flags (especially whether `consumption`/`service_use` count toward demand) are business-rule decisions that must come from you before 6.5d, though 6.5b can ship with conservative defaults (only `sale` counts as demand).
- **Outside current capability**: multi-currency financial rollup, demand forecast consumption (design undefined), inventory reconciliation (needs the movement ledger from 6.5b first).

## Developer Status Report

- **Inspected**: full ingestion stack (`sheet-table` → `classify`/`grain`/`mapping`/`profile`/`relationships`/`policy-detect` → `canonicalise` → `repository` → `ionic.functions`), the import wizard and data-sources UI, all planning engines (inventory, demand, supply, distribution, scenario, analytics), the canonical model, and the table/provenance layout.
- **Found**: a sound pipeline with one material semantic risk (movement→sales boundary), total loss of recognised-but-unstorable data after the session, snapshot-only inventory with no reconciliation path, dual unlabelled write-paths into monthly sales, forecasts stored-but-unconsumed (already tracked), no COGS/margin computation anywhere, and zero-value rows distorting demand and revenue.
- **Recommended**: explicit five-stage capability model, a conservative movement ledger with declarative per-class semantics, an optional bounded preservation vault, provenance backfill on `inventory`/`sales`, and a four-step sequence that never touches existing engine behaviour.
- **Uncertain**: real-world false-positive rate of the sales/movement boundary (needs an adversarial fixture corpus, proposed in 6.5b); whether `inspectUpload`/`importUpload` classification can diverge for the same file; how common $0-value rows are in real tenant data.
- **Deliberately unchanged**: all application code, migrations, ingestion behaviour, planning engines, UI, dependencies, and existing data — this task produced analysis only.
