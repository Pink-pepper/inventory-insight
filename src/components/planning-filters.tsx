import { Input } from "@/components/ui/input";
import type { PlanningFilter } from "@/lib/query/filters";

/** Values the workspace actually contains, returned by the server. */
export interface PlanningFilterOptions {
  categories: string[];
  suppliers: { code: string; name: string }[];
  channels: { code: string; name: string }[];
  customers: { ref: string; name: string }[];
  locations: { code: string; name: string }[];
  regions: string[];
  statesProvinces: string[];
  dateRange: { from: string; to: string } | null;
}

const selectClass =
  "h-9 rounded-md border border-input bg-surface px-2.5 text-sm text-foreground";

function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  if (options.length === 0) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const one = (value: string) => (value ? [value] : undefined);
const first = (values: string[] | undefined) => values?.[0] ?? "";

/**
 * Shared planning filter bar. It only offers dimensions the workspace actually
 * has data for, so a planner never filters into a guaranteed empty result.
 */
export function PlanningFilters({
  filter,
  options,
  onChange,
  showGrain = true,
  showCompare = true,
}: {
  filter: PlanningFilter;
  options: PlanningFilterOptions;
  onChange: (next: PlanningFilter) => void;
  showGrain?: boolean;
  showCompare?: boolean;
}) {
  const set = (patch: Partial<PlanningFilter>) => onChange({ ...filter, ...patch });

  return (
    <div className="panel flex flex-wrap items-end gap-3 px-3 py-3">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Search
        </span>
        <Input
          value={filter.search ?? ""}
          onChange={(e) => set({ search: e.target.value || undefined })}
          placeholder="SKU or product"
          className="h-9 w-44"
          maxLength={80}
        />
      </label>

      {showGrain ? (
        <Select
          label="Grain"
          allLabel="Month"
          value={filter.grain === "month" ? "" : (filter.grain ?? "")}
          onChange={(v) => set({ grain: (v || "month") as PlanningFilter["grain"] })}
          options={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "quarter", label: "Quarter" },
            { value: "year", label: "Year" },
          ]}
        />
      ) : null}

      {showCompare ? (
        <Select
          label="Compare"
          allLabel="No comparison"
          value={filter.compare === "none" ? "" : (filter.compare ?? "")}
          onChange={(v) => set({ compare: (v || "none") as PlanningFilter["compare"] })}
          options={[
            { value: "prev", label: "Previous period" },
            { value: "yoy", label: "Same period last year" },
          ]}
        />
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          From
        </span>
        <input
          type="date"
          className={selectClass}
          value={filter.from ?? ""}
          min={options.dateRange?.from}
          max={options.dateRange?.to}
          onChange={(e) => set({ from: e.target.value || undefined })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          To
        </span>
        <input
          type="date"
          className={selectClass}
          value={filter.to ?? ""}
          min={options.dateRange?.from}
          max={options.dateRange?.to}
          onChange={(e) => set({ to: e.target.value || undefined })}
        />
      </label>

      <Select
        label="Category"
        allLabel="All categories"
        value={first(filter.categories)}
        onChange={(v) => set({ categories: one(v) })}
        options={options.categories.map((c) => ({ value: c, label: c }))}
      />
      <Select
        label="Supplier"
        allLabel="All suppliers"
        value={first(filter.supplierCodes)}
        onChange={(v) => set({ supplierCodes: one(v) })}
        options={options.suppliers.map((s) => ({ value: s.code, label: s.name }))}
      />
      <Select
        label="Channel"
        allLabel="All channels"
        value={first(filter.channelCodes)}
        onChange={(v) => set({ channelCodes: one(v) })}
        options={options.channels.map((c) => ({ value: c.code, label: c.name }))}
      />
      <Select
        label="Customer"
        allLabel="All customers"
        value={first(filter.customerRefs)}
        onChange={(v) => set({ customerRefs: one(v) })}
        options={options.customers.map((c) => ({ value: c.ref, label: c.name }))}
      />
      <Select
        label="Location"
        allLabel="All locations"
        value={first(filter.locationCodes)}
        onChange={(v) => set({ locationCodes: one(v) })}
        options={options.locations.map((l) => ({ value: l.code, label: l.name }))}
      />
      <Select
        label="Region"
        allLabel="All regions"
        value={first(filter.regions)}
        onChange={(v) => set({ regions: one(v) })}
        options={options.regions.map((r) => ({ value: r, label: r }))}
      />

      <button
        type="button"
        onClick={() => onChange({})}
        className="ml-auto h-9 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        Reset filters
      </button>
    </div>
  );
}