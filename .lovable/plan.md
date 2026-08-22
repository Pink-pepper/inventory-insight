# Package 6 — Scenario Planning: Architecture & Implementation Proposal

Plan-mode deliverable. No code, migrations, or dependencies changed. Findings below are verified against the current codebase.

## A. Current architecture — what Packages 1–5 already provide

**Every planning engine is already a pure, configuration-driven function.** None read the database or React; the server functions load data and pass everything in:

- Demand: `buildDemandPlan({ facts, filter, policy, dimension })` → `computeBaseline(buckets, coverage, BaselinePolicy)` where `BaselinePolicy = { demandWindowMonths, planningHorizonDays, demandGrowthPct }`.
- Supply: `buildSupplyPlan({ facts, engineRows, openSupply, policy, filter })` — internally `resolveEngineConfig(policy)`, `computeBaseline`, `projectPosition`, `computeNetRequirement`.
- Distribution: `buildDistributionPlan({ supplyRows, facts, openSupply, policy, filter })`.
- Recommendation engine: `evaluateAll(signals, resolveEngineConfig(policy))` — config is a plain object.

**Critical consequence:** a scenario needs NO engine changes for policy-level overrides. A scenario is "a different `PlanningPolicy` object plus transformed inputs." The engines already accept both as arguments.

Other reusable pieces:

- `resolveEngineConfig()` merges any policy over `DEFAULT_ENGINE_CONFIG`; unset = default. Scenario overlays compose identically.
- Shared filter spec `planningFilterSchema` + `applyPlanningFilter` — scenario scoping (SKUs, categories, suppliers, locations, channels, regions) reuses this verbatim.
- Per-SKU input cascade in `loadSignals` (product → supplier → policy for lead time / MOQ / safety stock) — scenario per-supplier/per-SKU overrides are applied as an input transformation BEFORE the engines, not inside them.
- Deterministic explanation architecture (`buildExplanation`, `explainSupplyRow`) — reusable for scenario "why it changed" narratives via numeric diffs.
- Provenance precedent: `run_id`/`run_started_at` on recommendations, import batches with row hashes.
- Security precedent: `resolveOrg` server-side, RLS + GRANTs on every table, `has_org_role`, Zod validation, audit events on every mutation.
- Server-function precedent: `getSupplyPlan`/`getDistributionPlan`/`getDemandPlan` all compose the same loaders — a scenario run reuses this exact composition with substituted inputs.

## B. Scenario dependency map

```text
Scenario definition (name, scope filter, assumption overrides)
        │
        ▼
Input transformation (pure): adjust policy object + SKU signals + open PO ETAs
        │
        ▼
Demand Plan (computeBaseline — growth/window/horizon)
        ▼
Inventory Projection (projectPosition — unchanged)
        ▼
Supply Plan (buildSupplyPlan — net requirement, order-by, risks)
        ▼
Distribution (buildDistributionPlan — transfers against scenario requirements)
        ▼
Procurement impact (suggestedQty × unitCost — cost deltas where costs exist)
```

One run executes the whole chain in a single server function; engines are untouched.

## C. Scenario control matrix

| Control | Exists today? | Can be overridden? | Data sufficient? | Package 6 action |
|---|---|---|---|---|
| Demand growth % | Yes (`demandGrowthPct`, consumed by baseline) | Yes — policy override | Yes | **Support v1** |
| Historical demand window | Yes (`demandWindowMonths`) | Yes — policy override | Yes | **Support v1** |
| Planning horizon | Yes (`planningHorizonDays` → reviewPeriodDays) | Yes — policy override | Yes | **Support v1** |
| Demand method | Stored (`trailing_average` only) | No alternative exists | N/A | Disabled — only one method exists |
| Safety stock | Yes (`safetyStockDays`, product + policy) | Yes — policy + per-SKU override | Yes | **Support v1** |
| Target stock | Derived (lead + review + safety) | Indirectly via those inputs | Yes | Support via lead/horizon/safety overrides |
| Lead time | Yes (product/supplier/policy cascade) | Yes — input transform: org-wide delta or per-supplier override | Yes | **Support v1** |
| Lead-time variability | Stored, NOT consumed by any engine | No engine effect | N/A | Disabled — no consumer |
| MOQ | Yes (product/supplier/policy) | Yes — input transform | Yes | **Support v1** |
| Order multiple | Yes (`orderMultiple`) | Yes — policy override | Yes | **Support v1** |
| Supplier cost | Yes (`unit_cost`) | Yes — input transform % per supplier | Yes (single currency assumed; stated) | **Support v1** (spend impact only) |
| ETA / delivery delay | Yes (`expected_at` on open POs) | Yes — shift all ETAs by N days | Yes | **Support v1** |
| Supply availability | Partial (PO status exists) | Could exclude PO lines | Partial | Deferred — defer to keep v1 small |
| Distribution assumptions | Cover thresholds in engine config | Technically yes | Partial (location demand = transactions only) | Deferred — distribution output re-runs automatically via scenario supply rows |
| FX | `currency_code` stored on transactions/POs, no rates | No | **No** | Disabled — "FX rates not available" |
| Tariffs | No | No | **No** | Outside Package 6 |
| Seasonality | Stored flag, NOT consumed | No engine effect | No | Disabled — honest limitation |

## D. Proposed data model (minimum additive schema)

Two tables, both org-scoped, RLS + GRANTs following the existing pattern:

**`scenarios`** — the definition (mutable):
`id, org_id, name, description, status ('draft'|'active'|'archived'), scope jsonb (existing filter spec subset), assumptions jsonb (validated override object), created_by → auth.users, created_at, updated_at` (+ `touch_updated_at` trigger).

**`scenario_runs`** — immutable versioned results (append-only, like `audit_logs`/`import_batches`: no UPDATE/DELETE policies):
`id, org_id, scenario_id → scenarios, version integer (per-scenario sequence), assumptions jsonb (frozen copy), baseline_summary jsonb, scenario_summary jsonb, row_results jsonb (per-SKU baseline vs scenario key figures), input_provenance jsonb (data timestamp, source coverage, lastRun ref), created_by, created_at`.

Assumptions as **validated JSONB** (Zod schema at every boundary), not normalized columns — the override set will evolve and mirrors the existing policy shape. No third table.

## E. Calculation architecture

New pure module `src/lib/scenario/` (mirrors `src/lib/supply/` discipline):

1. `assumptions.ts` — `ScenarioAssumptions` type + Zod schema + "diff against effective policy" descriptor for the what-changed panel.
2. `apply.ts` — `applyScenario({ policy, signals, facts, openSupply }, assumptions, scope)` → returns **copies**: an overridden `PlanningPolicy`, adjusted SKU signals (lead time, MOQ, safety days, unit cost), ETA-shifted open supply. Scoped overrides apply only to rows matching the scope filter; everything else passes through untouched. Pure, no DB.
3. `run.ts` — `runScenario(...)` composes `buildSupplyPlan` + `buildDistributionPlan` twice (baseline inputs vs scenario inputs, same facts) and produces the comparison. Baseline is recomputed in the same request from the same data — guaranteed like-for-like, no stale stored baseline.
4. `compare.ts` — variance math: absolute deltas always; percentages only when baseline ≠ 0; explicit "unavailable — insufficient data" states (never zero-fill).

Engines receive scenario configuration through their existing arguments. No engine edits, no engine duplication.

## F. Persistence / versioning

Recommended: **C — persist both configuration and output snapshots** (the brief's option C).

- Editing a scenario updates `scenarios` (definition is mutable; it is not a result).
- **Run = immutable version.** Re-running after an assumption change inserts a new `scenario_runs` row with `version = max+1` and a frozen copy of the assumptions. Previous runs are never overwritten — full traceability.
- Full per-SKU row results stored as JSONB: at demo scale (50 SKUs) this is kilobytes; cap at a documented limit (e.g. 2,000 rows/run) with an explicit truncation flag if ever hit.
- Each run stores `input_provenance` (calculation timestamp, demand-fact coverage, recommendation `run_id` the engine rows derive from) so a saved scenario stays interpretable after live data changes — and gives Package 7 its anchor.

## G. Comparison architecture

Baseline vs scenario computed side-by-side per SKU and in summary:

- Demand: planned per period / horizon total.
- Supply: net requirement, suggested qty, order-by date, stockout/below-safety period shifts (e.g. "October → September").
- Distribution: transferable units, remaining purchase requirement, avoidable spend.
- Procurement: suggested spend delta where all costs exist; otherwise "cost impact unavailable".
- Risk flags: gained/resolved flags per SKU.

Absolute change always shown; percentage only for non-zero baselines. Zero baseline with non-zero scenario shows "new requirement", not "∞%".

## H. UI architecture

One new workspace `src/routes/_authenticated/scenarios.tsx` (+ optional `$scenarioId` detail), nav entry in `app-shell.tsx` ("Scenarios" after Distribution). Reuses existing components: `planning-filters`, `status-badge`, metric cards, explanation panels, table/chart patterns from Supply Planning.

1. **Scenario list** — name, status, versions count, last run at, created by.
2. **Builder** — name/description, scope picker (existing filter control), assumption controls (only supported ones; unsupported ones visibly disabled with the reason), Run button.
3. **Results** — what-changed panel (assumption diffs), impact summary (demand/supply/distribution/procurement deltas), per-SKU comparison table, deterministic explanation ("Lead time 30→45 raised reorder point …, moving stockout from October to September").
4. **Versions** — run history per scenario; select two versions to compare later (v1: compare run vs its own baseline only; run-vs-run comparison is a stated v1.1 candidate).

No redesign; no new visual language.

## I. Permissions / security

- Roles unchanged: `owner`, `admin`, `member` (no viewer role exists — none invented).
- Create/edit/run scenarios: all members (scenarios are read-only against live data by construction).
- Archive/delete: owner/admin only — enforced in the server function AND RLS via existing `has_org_role`, mirroring `clearWorkspaceData` and PO-approval precedent.
- RLS: `org_id = memberships` select for members; insert/update for members of the org; delete owner/admin. GRANTs: `authenticated` CRUD per policy, `service_role` ALL, no `anon`.
- `org_id` always from `resolveOrg(context)`; every input Zod-validated; audit events `scenario.created/updated/run/archived`; CSRF/security headers untouched. Scenario runs never call `persistDataset`, `persistPurchaseOrders`, `regenerateRecommendations`, or `savePlanningPolicy` — isolation by construction, verified by tests.

## J. Performance

Synchronous execution is safe. A run = the same ~5 org-scoped queries the Supply Planning page already does + two in-memory passes of the engine chain (~50 SKUs, ~600 sales rows). This already happens on every Supply/Distribution page load today with no issue. No queues, no background jobs. If future data volumes (10k+ SKUs) demand it, the immutable-run table is already the right shape for async execution later — noted, not built.

## K. Backward compatibility

- Additive only: two new tables, one new route, one new `src/lib/scenario/` module, new server functions in `ionic.functions.ts` (kept thin — logic in `src/lib/scenario/` and repository, per the createServerFn wrapper rule).
- No changes to engine signatures, policy table, existing server functions, or RLS on existing tables. Packages 1–5 output is bit-identical: baseline path uses the same inputs the live pages use.

## L. Package 7 readiness (Plan vs Actual)

Each `scenario_runs` row preserves: frozen assumptions, baseline + scenario summaries, per-SKU planned figures, input provenance (data coverage + calculation timestamp). That is exactly what Plan vs Actual needs to later answer "scenario plan vs what actually happened." No additional work now.

## M. Package 8 boundary

Explicitly NOT built: autonomous monitoring, proactive alerts, agentic/AI scenario generation, AI recommendations, autonomous procurement/transfers. The immutable run table and structured summaries are consumable by a future intelligence layer without rework — that is the only concession.

## N. Risks / unknowns

1. **Currency mixing** — `unit_cost` has no currency on products; cost comparisons assume one currency. Stated in UI when spend is shown; FX explicitly out.
2. **Location demand** exists only in day-grain transactions; scenario distribution results carry the existing `noLocationDemand` honesty flag.
3. **Run-vs-run comparison** (two scenario versions directly) deferred to v1.1 — confirm acceptable.
4. **Scenario scope** v1 = one filter set per scenario applied to the whole run; per-SKU-different assumptions (e.g. growth +20% for one SKU only) are supported via scope+override but the UI keeps it simple: one assumption set per scenario.
5. Run size cap value (2,000 rows) is a guess — trivially adjustable.

## O. Implementation sequence

- **Phase 6A — Pure scenario core.** `src/lib/scenario/` (assumptions schema, input transformation, run composition, comparison math, what-changed/why explanations) + unit tests alongside `src/lib/supply/*.test.ts` precedent. No DB, no UI.
- **Phase 6B — Schema.** Migration: `scenarios`, `scenario_runs`, GRANTs, RLS, trigger, updated generated types. Repository: CRUD + run insert/list (append-only).
- **Phase 6C — Server functions.** `listScenarios`, `getScenario` (with runs), `saveScenario`, `runScenario`, `archiveScenario` — all Zod-validated, org-resolved, audited, role-checked. Thin wrappers only.
- **Phase 6D — UI.** Scenarios workspace: list, builder, results/comparison, versions; nav entry; disabled-with-reason unsupported controls.
- **Phase 6E — Verification.** Unit tests green; build clean; live preview check of full configure→run→adjust→rerun→compare flow; regression pass over Packages 1–5 screens; confirm zero writes to live tables during scenario runs.

## P. Outside capability (explicitly not implementable now)

- FX/tariff scenario modelling — no rates data, no feed; control shown disabled with reason.
- Alternative demand methods / seasonality — only `trailing_average` exists; stored flags have no engine consumer.
- Lead-time variability, supplier-performance prediction, transfer cost/transit modelling — no consuming engine and/or no data.
- Background/async execution — not justified at current volumes; infrastructure deliberately not added.
- Anything requiring writes to live planning data from a scenario — excluded by design.
