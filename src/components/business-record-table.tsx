/**
 * One operational table used by every Business screen.
 *
 * Progressive disclosure by construction: the row shows the few facts an
 * operator scans for, expanding a row reveals the evidence behind it, and the
 * editor only appears when the user asks for it. Screens describe their
 * fields; none of them re-implement table, form or mutation behaviour.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Plus, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/app-shell";
import {
  deleteBusinessRecord,
  promoteToDemandBook,
  saveBusinessRecord,
} from "@/lib/business.functions";
import { deleteSupplyRecordFn, saveSupplyRecordFn } from "@/lib/supply.functions";
import { cn } from "@/lib/utils";

export type FieldType = "text" | "textarea" | "number" | "percent" | "date" | "select";

export interface FieldSpec {
  /** Storage column name — this is what the server schema validates. */
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  /** Default for a new record. */
  defaultValue?: string | number | null;
}

export interface ColumnSpec<T> {
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface DetailSpec<T> {
  label: string;
  render: (row: T) => ReactNode;
}

export type BusinessTable =
  | "contacts"
  | "requirements"
  | "opportunities"
  | "quotations"
  | "customer_orders"
  | "market_signals"
  | "demand_signals";

export type SupplyTableName =
  | "supplier_products"
  | "cost_components"
  | "shipments"
  | "shipment_lines";

export interface BusinessRecordTableProps<T extends { id: string }> {
  table: BusinessTable | SupplyTableName;
  /** Which write surface backs this table. Defaults to the commercial one. */
  domain?: "business" | "supply";
  /** Query keys to refresh after any write. */
  invalidate: string[][];
  rows: T[];
  columns: ColumnSpec<T>[];
  details?: DetailSpec<T>[];
  fields: FieldSpec[];
  /** Maps a record back to editor values. */
  toValues: (row: T) => Record<string, unknown>;
  emptyTitle: string;
  emptyBody: string;
  newLabel: string;
  /** When set, rows can be promoted into the Demand Book. */
  promoteAs?: "requirement" | "opportunity" | "quotation" | "customer_order";
}


const isBlank = (v: unknown) => v === "" || v === undefined || v === null;

function coerce(field: FieldSpec, raw: string): unknown {
  if (isBlank(raw)) return field.required ? (field.type === "number" ? 0 : "") : null;
  if (field.type === "number") return Number(raw);
  if (field.type === "percent") return Number(raw) / 100;
  return raw;
}

function initialForm(fields: FieldSpec[], values?: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = values?.[f.key] ?? f.defaultValue ?? "";
    if (v === null || v === undefined) out[f.key] = "";
    else if (f.type === "percent") out[f.key] = String(Math.round(Number(v) * 100));
    else out[f.key] = String(v);
  }
  return out;
}

export function BusinessRecordTable<T extends { id: string }>({
  table,
  domain = "business",
  invalidate,
  rows,
  columns,
  details = [],
  fields,
  toValues,
  emptyTitle,
  emptyBody,
  newLabel,
  promoteAs,
}: BusinessRecordTableProps<T>) {
  const queryClient = useQueryClient();
  const saveBusiness = useServerFn(saveBusinessRecord);
  const deleteBusiness = useServerFn(deleteBusinessRecord);
  const saveSupply = useServerFn(saveSupplyRecordFn);
  const deleteSupply = useServerFn(deleteSupplyRecordFn);
  const promoteFn = useServerFn(promoteToDemandBook);
  const saveFn = domain === "supply" ? saveSupply : saveBusiness;
  const deleteFn = domain === "supply" ? deleteSupply : deleteBusiness;

  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: Record<string, string> } | null>(
    null,
  );

  const refresh = () => {
    for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: key });
  };

  const save = useMutation({
    mutationFn: (input: { id: string | null; values: Record<string, unknown> }) =>
      saveFn({ data: { table, id: input.id, values: input.values } as never }),
    onSuccess: () => {
      toast.success("Saved");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save this record."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { table, id } as never }),
    onSuccess: () => {
      toast.success("Deleted");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete this record."),
  });


  const promote = useMutation({
    mutationFn: (id: string) =>
      promoteFn({ data: { recordType: promoteAs!, recordId: id } }),
    onSuccess: () => {
      toast.success("Added to the Demand Book");
      void queryClient.invalidateQueries({ queryKey: ["demand-book"] });
      refresh();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not add this record to the Demand Book."),
  });

  const header = useMemo(
    () => (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "record" : "records"}
        </p>
        <Button size="sm" onClick={() => setEditing({ id: null, form: initialForm(fields) })}>
          <Plus className="size-4" /> {newLabel}
        </Button>
      </div>
    ),
    [rows.length, fields, newLabel],
  );

  return (
    <div className="space-y-4">
      {header}

      {rows.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          body={emptyBody}
          action={
            <Button size="sm" onClick={() => setEditing({ id: null, form: initialForm(fields) })}>
              <Plus className="size-4" /> {newLabel}
            </Button>
          }
        />
      ) : (
        <div className="panel divide-y divide-border">
          <div className="grid gap-3 bg-surface-muted px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            style={{ gridTemplateColumns: `1.5rem repeat(${columns.length}, minmax(0, 1fr)) 7rem` }}>
            <span />
            {columns.map((c) => (
              <span key={c.label} className={c.className}>
                {c.label}
              </span>
            ))}
            <span className="text-right">Actions</span>
          </div>

          {rows.map((row) => {
            const open = expanded === row.id;
            return (
              <div key={row.id}>
                <div
                  className="grid items-center gap-3 px-3 py-3 text-sm transition-colors hover:bg-surface-muted/60"
                  style={{ gridTemplateColumns: `1.5rem repeat(${columns.length}, minmax(0, 1fr)) 7rem` }}
                >
                  <button
                    onClick={() => setExpanded(open ? null : row.id)}
                    aria-label={open ? "Collapse details" : "Expand details"}
                    className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                  </button>
                  {columns.map((c) => (
                    <div key={c.label} className={cn("min-w-0 truncate", c.className)}>
                      {c.render(row)}
                    </div>
                  ))}
                  <div className="flex items-center justify-end gap-1">
                    {promoteAs ? (
                      <button
                        title="Add to Demand Book"
                        aria-label="Add to Demand Book"
                        disabled={promote.isPending}
                        onClick={() => promote.mutate(row.id)}
                        className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                      >
                        <ArrowUpRight className="size-4" />
                      </button>
                    ) : null}
                    <button
                      title="Edit"
                      aria-label="Edit"
                      onClick={() => setEditing({ id: row.id, form: initialForm(fields, toValues(row)) })}
                      className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      title="Delete"
                      aria-label="Delete"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(row.id)}
                      className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {open && details.length > 0 ? (
                  <div className="grid gap-4 border-t border-border bg-surface-muted/40 px-10 py-4 sm:grid-cols-2 lg:grid-cols-3">
                    {details.map((d) => (
                      <div key={d.label}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {d.label}
                        </p>
                        <div className="mt-1 text-sm text-foreground">{d.render(row)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => (o ? null : setEditing(null))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit record" : newLabel}</DialogTitle>
            <DialogDescription>
              Only the fields below are stored. Everything is scoped to your workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
                <Label htmlFor={f.key} className="text-xs">
                  {f.label}
                  {f.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                {f.type === "select" ? (
                  <select
                    id={f.key}
                    value={editing?.form[f.key] ?? ""}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, form: { ...prev.form, [f.key]: e.target.value } } : prev,
                      )
                    }
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <Textarea
                    id={f.key}
                    className="mt-1"
                    rows={3}
                    value={editing?.form[f.key] ?? ""}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, form: { ...prev.form, [f.key]: e.target.value } } : prev,
                      )
                    }
                  />
                ) : (
                  <Input
                    id={f.key}
                    className="mt-1"
                    type={f.type === "date" ? "date" : f.type === "text" ? "text" : "number"}
                    value={editing?.form[f.key] ?? ""}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev ? { ...prev, form: { ...prev.form, [f.key]: e.target.value } } : prev,
                      )
                    }
                  />
                )}
                {f.help ? <p className="mt-1 text-[11px] text-muted-foreground">{f.help}</p> : null}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (!editing) return;
                const values: Record<string, unknown> = {};
                for (const f of fields) {
                  const raw = editing.form[f.key] ?? "";
                  if (f.required && isBlank(raw)) {
                    toast.error(`${f.label} is required.`);
                    return;
                  }
                  values[f.key] = coerce(f, raw);
                }
                save.mutate({ id: editing.id, values });
              }}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
