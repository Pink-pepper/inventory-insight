/**
 * Scenario definition form: name, scope, and the assumption set.
 *
 * Every assumption starts "not set" (empty input) — a scenario only ever
 * contains what the planner deliberately changed. Submitting validates
 * against the shared assumptions schema, so the client and the server hold
 * the same contract.
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlanningFilters, type PlanningFilterOptions } from "@/components/planning-filters";
import type { PlanningFilter } from "@/lib/query/filters";
import type { PlanningPolicy } from "@/lib/domain/planning-policy";
import {
  scenarioAssumptionsSchema,
  type ScenarioAssumptions,
} from "@/lib/scenario/assumptions";

export interface ScenarioFormValues {
  name: string;
  description: string | null;
  scope: PlanningFilter;
  assumptions: ScenarioAssumptions;
}

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-surface px-2.5 text-sm text-foreground";

function NumberField({
  label,
  hint,
  value,
  onChange,
  step = "1",
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        step={step}
        className={fieldClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Not set"
      />
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );
}

interface SupplierRow {
  supplierCode: string;
  value: string;
}

function SupplierRows({
  label,
  valueLabel,
  step = "1",
  rows,
  options,
  onChange,
}: {
  label: string;
  valueLabel: string;
  step?: string;
  rows: SupplierRow[];
  options: { code: string; name: string }[];
  onChange: (rows: SupplierRow[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange([...rows, { supplierCode: "", value: "" }])}
        >
          <Plus className="mr-1 size-3.5" /> Add
        </Button>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            className={fieldClass}
            value={row.supplierCode}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, supplierCode: e.target.value } : r)))
            }
          >
            <option value="">Choose supplier…</option>
            {options.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
          <input
            type="number"
            step={step}
            className={fieldClass}
            value={row.value}
            placeholder={valueLabel}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
            }
          />
          <button
            type="button"
            aria-label="Remove row"
            className="rounded-sm p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">None — recorded values are used.</p>
      ) : null}
    </div>
  );
}

const toNum = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const fromNum = (v: number | null | undefined): string => (v == null ? "" : String(v));

export function ScenarioForm({
  initial,
  options,
  policy,
  submitting,
  submitLabel,
  onSubmit,
}: {
  initial?: ScenarioFormValues;
  options: PlanningFilterOptions;
  policy: PlanningPolicy;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (values: ScenarioFormValues) => void;
}) {
  const a = initial?.assumptions ?? {};
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scope, setScope] = useState<PlanningFilter>(initial?.scope ?? {});
  const [showScope, setShowScope] = useState(
    Object.keys(initial?.scope ?? {}).length > 0,
  );
  const [demandGrowthPct, setDemandGrowthPct] = useState(fromNum(a.demandGrowthPct));
  const [demandWindowMonths, setDemandWindowMonths] = useState(fromNum(a.demandWindowMonths));
  const [planningHorizonDays, setPlanningHorizonDays] = useState(fromNum(a.planningHorizonDays));
  const [safetyStockDays, setSafetyStockDays] = useState(fromNum(a.safetyStockDays));
  const [orderMultiple, setOrderMultiple] = useState(fromNum(a.orderMultiple));
  const [leadTimeDeltaDays, setLeadTimeDeltaDays] = useState(fromNum(a.leadTimeDeltaDays));
  const [minOrderQtyChangePct, setMinOrderQtyChangePct] = useState(fromNum(a.minOrderQtyChangePct));
  const [etaDelayDays, setEtaDelayDays] = useState(fromNum(a.etaDelayDays));
  const [leadRows, setLeadRows] = useState<SupplierRow[]>(
    (a.supplierLeadTimes ?? []).map((s) => ({
      supplierCode: s.supplierCode,
      value: String(s.leadTimeDays),
    })),
  );
  const [costRows, setCostRows] = useState<SupplierRow[]>(
    (a.supplierCostChanges ?? []).map((s) => ({
      supplierCode: s.supplierCode,
      value: String(s.changePct),
    })),
  );
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const parsed = scenarioAssumptionsSchema.safeParse({
      demandGrowthPct: toNum(demandGrowthPct),
      demandWindowMonths: toNum(demandWindowMonths),
      planningHorizonDays: toNum(planningHorizonDays),
      safetyStockDays: toNum(safetyStockDays),
      orderMultiple: toNum(orderMultiple),
      leadTimeDeltaDays: toNum(leadTimeDeltaDays),
      minOrderQtyChangePct: toNum(minOrderQtyChangePct),
      etaDelayDays: toNum(etaDelayDays),
      supplierLeadTimes: leadRows
        .filter((r) => r.supplierCode && r.value.trim() !== "")
        .map((r) => ({ supplierCode: r.supplierCode, leadTimeDays: Number(r.value) })),
      supplierCostChanges: costRows
        .filter((r) => r.supplierCode && r.value.trim() !== "")
        .map((r) => ({ supplierCode: r.supplierCode, changePct: Number(r.value) })),
    });
    if (!name.trim()) {
      setError("Give the scenario a name.");
      return;
    }
    if (!parsed.success) {
      setError(
        "Check the assumptions: " +
          parsed.error.issues
            .slice(0, 2)
            .map((i) => `${i.path.join(".") || "value"} — ${i.message}`)
            .join("; "),
      );
      return;
    }
    setError(null);
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      scope,
      assumptions: parsed.data,
    });
  }

  const live = (v: number | null, unit: string) =>
    v == null ? `Currently: engine default` : `Currently: ${v}${unit}`;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Name
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Supplier disruption — Q1"
            maxLength={200}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Description
          </span>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What question does this scenario answer?"
            rows={1}
            maxLength={2000}
            className="min-h-9"
          />
        </label>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground">Demand assumptions</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Demand growth %"
            hint={live(policy.demandGrowthPct, "%") + " per cycle"}
            value={demandGrowthPct}
            onChange={setDemandGrowthPct}
            step="0.5"
          />
          <NumberField
            label="Demand window (months)"
            hint={live(policy.demandWindowMonths, " months") + " of history"}
            value={demandWindowMonths}
            onChange={setDemandWindowMonths}
          />
          <NumberField
            label="Planning horizon (days)"
            hint={live(policy.planningHorizonDays, " days")}
            value={planningHorizonDays}
            onChange={setPlanningHorizonDays}
          />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground">Inventory assumptions</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Safety stock (days)"
            hint="Overrides every product in scope"
            value={safetyStockDays}
            onChange={setSafetyStockDays}
          />
          <NumberField
            label="Order multiple"
            hint={live(policy.orderMultiple, "") + " — quantities round up to this"}
            value={orderMultiple}
            onChange={setOrderMultiple}
          />
          <NumberField
            label="Min order qty change %"
            hint="Scales every MOQ in scope"
            value={minOrderQtyChangePct}
            onChange={setMinOrderQtyChangePct}
            step="1"
          />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground">Supply assumptions</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Lead time change (days)"
            hint="Added to every known lead time; never invents one"
            value={leadTimeDeltaDays}
            onChange={setLeadTimeDeltaDays}
          />
          <NumberField
            label="Inbound ETA delay (days)"
            hint="Shifts every scheduled delivery later"
            value={etaDelayDays}
            onChange={setEtaDelayDays}
          />
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <SupplierRows
            label="Supplier lead times (days)"
            valueLabel="days"
            rows={leadRows}
            options={options.suppliers}
            onChange={setLeadRows}
          />
          <SupplierRows
            label="Supplier cost changes (%)"
            valueLabel="%"
            step="0.5"
            rows={costRows}
            options={options.suppliers}
            onChange={setCostRows}
          />
        </div>
      </div>

      <div>
        <button
          type="button"
          className="text-xs font-semibold text-foreground underline-offset-4 hover:underline"
          onClick={() => setShowScope(!showScope)}
        >
          {showScope ? "− Hide scope" : "+ Limit scope (optional)"}
        </button>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Without a scope the scenario covers the whole workspace. A scope restricts both the
          baseline and the scenario to the same slice, so the comparison stays honest.
        </p>
        {showScope ? (
          <div className="mt-2">
            <PlanningFilters
              filter={scope}
              options={options}
              onChange={setScope}
              showGrain={false}
              showCompare={false}
            />
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-status-reorder">{error}</p> : null}

      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
