import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updatePlanningPolicy } from "@/lib/ionic.functions";
import {
  EMPTY_PLANNING_POLICY,
  type PlanningPolicy,
  type ProductDisplay,
} from "@/lib/domain/planning-policy";
import { BASE_CURRENCY, CURRENCY_OPTIONS } from "@/lib/domain/currency";

type NumericField = {
  key: keyof PlanningPolicy;
  label: string;
  hint: string;
  step?: string;
};

/** Parameters the engine reads today. */
const ACTIVE_FIELDS: NumericField[] = [
  {
    key: "demandWindowMonths",
    label: "Historical demand period (months)",
    hint: "Default 6",
  },
  { key: "planningHorizonDays", label: "Planning horizon (days)", hint: "Default 30" },
  { key: "defaultLeadTimeDays", label: "Default supplier lead time (days)", hint: "Used only when neither product nor supplier declares one" },
  { key: "defaultMinOrderQty", label: "Default minimum order quantity", hint: "Used only when no MOQ is known" },
  { key: "orderMultiple", label: "Order multiple", hint: "Order quantities round up to this multiple" },
  { key: "safetyStockDays", label: "Safety stock (days)", hint: "Used only when a product has no safety buffer" },
];

/** Stored for future planning packages; they do not change today's numbers. */
const STORED_FIELDS: NumericField[] = [
  { key: "reorderPointOverride", label: "Reorder point override", hint: "" },
  { key: "minimumStockLevel", label: "Minimum stock level", hint: "" },
  { key: "targetStockLevel", label: "Target stock level", hint: "" },
  { key: "daysOfCoverTarget", label: "Days of cover target", hint: "" },
  { key: "serviceLevel", label: "Service level (0–1)", hint: "", step: "0.01" },
  { key: "demandVariability", label: "Demand variability", hint: "", step: "0.01" },
  { key: "leadTimeVariabilityDays", label: "Lead-time variability (days)", hint: "", step: "0.1" },
];

/** Consumed by the demand plan, not by the recommendation engine. */
const DEMAND_FIELDS: NumericField[] = [
  {
    key: "demandGrowthPct",
    label: "Growth / decline (%)",
    hint: "Applied to the trailing average on the Demand Planning page",
    step: "0.1",
  },
];

const DISPLAY_OPTIONS: { value: ProductDisplay; label: string }[] = [
  { value: "sku", label: "SKU" },
  { value: "name", label: "Product name" },
  { value: "sku_name", label: "SKU + product name" },
];

function toInput(value: PlanningPolicy[keyof PlanningPolicy]): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  return String(value);
}

export function PlanningPolicyForm({
  policy,
  canManage,
}: {
  policy: PlanningPolicy;
  canManage: boolean;
}) {
  const save = useServerFn(updatePlanningPolicy);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PlanningPolicy>(policy);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(policy), [policy]);

  function setNumber(key: keyof PlanningPolicy, raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    setDraft((d) => ({ ...d, [key]: value === null || Number.isNaN(value) ? null : value }));
  }

  async function submit() {
    setBusy(true);
    try {
      const saved = await save({ data: { ...draft } });
      setDraft(saved);
      await queryClient.invalidateQueries();
      toast.success("Planning policy saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the planning policy");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDraft({
      ...EMPTY_PLANNING_POLICY,
      productDisplay: draft.productDisplay,
      displayCurrency: draft.displayCurrency,
      fxRates: draft.fxRates,
    });
  }

  const field = (f: NumericField) => (
    <label key={String(f.key)} className="block">
      <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
      <input
        type="number"
        step={f.step ?? "1"}
        disabled={!canManage}
        value={toInput(draft[f.key])}
        placeholder="Not set"
        onChange={(e) => setNumber(f.key, e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm tabular outline-none focus:border-ring disabled:opacity-60"
      />
      {f.hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{f.hint}</span> : null}
    </label>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Active parameters
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Left blank, each parameter keeps Ionic's documented default and recommendations behave
          exactly as they do today.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACTIVE_FIELDS.map(field)}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Demand planning
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The demand window and planning horizon above also drive the demand baseline. These values
          change the planned demand shown on the Demand Planning page; they do not change
          recommendation quantities.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DEMAND_FIELDS.map(field)}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Product display
        </h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {DISPLAY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={!canManage}
              onClick={() => setDraft((d) => ({ ...d, productDisplay: o.value }))}
              className={
                draft.productDisplay === o.value
                  ? "rounded-md border border-ring bg-accent px-3 py-1.5 text-xs font-medium"
                  : "rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-60"
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Display currency
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Amounts are stored in {BASE_CURRENCY} and converted for display only, using the manual
          rate you enter. This is a reading convenience, not accounting-grade FX.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-foreground">Currency</span>
            <select
              disabled={!canManage}
              value={draft.displayCurrency ?? BASE_CURRENCY}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  displayCurrency: e.target.value === BASE_CURRENCY ? null : e.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm disabled:opacity-60"
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c === BASE_CURRENCY ? " (as stored)" : ""}
                </option>
              ))}
            </select>
          </label>
          {draft.displayCurrency && draft.displayCurrency !== BASE_CURRENCY ? (
            <label className="block">
              <span className="text-xs font-medium text-foreground">
                Rate — {draft.displayCurrency} per 1 {BASE_CURRENCY}
              </span>
              <input
                type="number"
                step="0.0001"
                min="0"
                disabled={!canManage}
                value={draft.fxRates?.[draft.displayCurrency] ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    fxRates: {
                      ...(d.fxRates ?? {}),
                      [d.displayCurrency as string]: Number(e.target.value),
                    },
                  }))
                }
                className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm disabled:opacity-60"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Without a rate, figures stay in {BASE_CURRENCY}.
              </span>
            </label>
          ) : null}
        </div>
      </div>


      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Stored for future planning
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          These values are saved with your workspace but do not affect any recommendation
          calculation yet. They will be used by the planning modules when those ship.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STORED_FIELDS.map(field)}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            disabled={!canManage}
            checked={draft.seasonalityEnabled === true}
            onChange={(e) => setDraft((d) => ({ ...d, seasonalityEnabled: e.target.checked }))}
          />
          Seasonality assumption enabled (stored, not yet applied)
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={!canManage || busy}>
          {busy ? "Saving…" : "Save policy"}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset} disabled={!canManage || busy}>
          Clear to defaults
        </Button>
        {!canManage ? (
          <span className="text-xs text-muted-foreground">
            Only owners and admins can change the planning policy.
          </span>
        ) : null}
      </div>
    </div>
  );
}