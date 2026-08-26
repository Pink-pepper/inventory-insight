import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell, EmptyState, Loading } from "@/components/app-shell";
import { Pill } from "@/components/status-badge";
import { BusinessRecordTable, type FieldSpec } from "@/components/business-record-table";
import { getBusinessBook } from "@/lib/business.functions";
import { getProjects } from "@/lib/projects.functions";
import { PROJECT_STAGE_LABEL } from "@/lib/domain/project";
import { money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/business/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Ionic" },
      {
        name: "description",
        content:
          "Customer accounts and the people behind them, with a plain-language summary of every live relationship.",
      },
      { property: "og:title", content: "Customers — Ionic" },
      {
        property: "og:description",
        content: "See each customer account, its contacts, and the open business attached to it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomersPage,
});

interface Relationship {
  contacts: number;
  projects: { id: string; name: string; stage: string; value: number | null }[];
  quotations: { id: string; label: string; value: number; status: string }[];
  orders: { id: string; label: string; value: number; status: string }[];
  requirements: number;
  opportunities: number;
  signals: { id: string; title: string; impact: string; observedOn: string }[];
  openValue: number;
  committedValue: number;
  lastActivity: string | null;
}

function emptyRelationship(): Relationship {
  return {
    contacts: 0,
    projects: [],
    quotations: [],
    orders: [],
    requirements: 0,
    opportunities: 0,
    signals: [],
    openValue: 0,
    committedValue: 0,
    lastActivity: null,
  };
}

/** One sentence a person can read out loud. No jargon, no derived scores. */
function summarise(name: string, r: Relationship): string {
  const parts: string[] = [];
  if (r.projects.length) parts.push(`${r.projects.length} live ${r.projects.length === 1 ? "project" : "projects"}`);
  if (r.quotations.length)
    parts.push(`${r.quotations.length} open ${r.quotations.length === 1 ? "quotation" : "quotations"} worth ${money(r.openValue)}`);
  if (r.orders.length)
    parts.push(`${r.orders.length} confirmed ${r.orders.length === 1 ? "order" : "orders"} worth ${money(r.committedValue)}`);
  if (r.requirements) parts.push(`${r.requirements} stated ${r.requirements === 1 ? "requirement" : "requirements"}`);
  if (r.opportunities) parts.push(`${r.opportunities} tracked ${r.opportunities === 1 ? "opportunity" : "opportunities"}`);
  if (!parts.length) return `No commercial activity recorded against ${name} yet.`;
  const last = parts.pop()!;
  const body = parts.length ? `${parts.join(", ")} and ${last}` : last;
  const tail = r.signals.length
    ? ` ${r.signals.length} market ${r.signals.length === 1 ? "signal" : "signals"} noted.`
    : "";
  return `${name} has ${body}.${tail}`;
}

function CustomersPage() {
  const bookFn = useServerFn(getBusinessBook);
  const projectsFn = useServerFn(getProjects);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["business-book"],
    queryFn: () => bookFn(),
  });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => projectsFn() });
  const [open, setOpen] = useState<string | null>(null);

  const relationships = useMemo(() => {
    const map = new Map<string, Relationship>();
    if (!data) return map;
    const get = (id: string | null) => {
      if (!id) return null;
      let row = map.get(id);
      if (!row) {
        row = emptyRelationship();
        map.set(id, row);
      }
      return row;
    };
    const touch = (row: Relationship, date: string | null | undefined) => {
      if (date && (!row.lastActivity || date > row.lastActivity)) row.lastActivity = date;
    };

    for (const c of data.contacts) {
      const r = get(c.customerId);
      if (r) r.contacts += 1;
    }
    for (const q of data.requirements) {
      const r = get(q.customerId);
      if (!r) continue;
      if (q.status === "open") r.requirements += 1;
      touch(r, q.periodStart);
    }
    for (const o of data.opportunities) {
      const r = get(o.customerId);
      if (!r) continue;
      if (o.status === "open") r.opportunities += 1;
      touch(r, o.expectedPeriod);
    }
    for (const q of data.quotations) {
      const r = get(q.customerId);
      if (!r) continue;
      const value = (q.unitPrice ?? 0) * q.quantity;
      if (q.status === "open") {
        r.openValue += value;
        r.quotations.push({
          id: q.id,
          label: `${q.reference ?? "Quotation"} · ${q.productName ?? q.sku ?? "Unassigned product"} · ${num(q.quantity)}`,
          value,
          status: q.status,
        });
      }
      touch(r, q.issuedOn ?? q.expectedPeriod);
    }
    for (const o of data.customerOrders) {
      const r = get(o.customerId);
      if (!r) continue;
      const value = (o.unitPrice ?? 0) * o.quantity;
      if (o.status === "open" || o.status === "won" || o.status === "fulfilled") {
        r.committedValue += value;
        r.orders.push({
          id: o.id,
          label: `${o.reference ?? "Order"} · ${o.productName ?? o.sku ?? "Unassigned product"} · ${num(o.quantity)}`,
          value,
          status: o.status,
        });
      }
      touch(r, o.periodStart);
    }
    for (const s of data.marketSignals) {
      const r = get(s.customerId);
      if (!r) continue;
      r.signals.push({ id: s.id, title: s.title, impact: s.impact, observedOn: s.observedOn });
      touch(r, s.observedOn);
    }
    for (const p of projects ?? []) {
      const r = get(p.customerId);
      if (!r) continue;
      if (p.status === "open") {
        r.projects.push({
          id: p.id,
          name: p.name,
          stage: PROJECT_STAGE_LABEL[p.stage] ?? p.stage,
          value: p.expectedValue,
        });
      }
      touch(r, p.expectedClose);
    }
    return map;
  }, [data, projects]);

  const contactFields: FieldSpec[] = useMemo(
    () => [
      { key: "name", label: "Name", type: "text", required: true },
      {
        key: "customer_id",
        label: "Customer",
        type: "select",
        options: (data?.customers ?? []).map((c) => ({ value: c.id, label: c.name })),
      },
      { key: "role", label: "Role", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    [data],
  );

  return (
    <AppShell
      title="Customers"
      description="Every account, described in plain language, with the business currently attached to it."
    >
      {isLoading ? (
        <Loading label="Loading customers" />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load customers."}
        </p>
      ) : !data ? null : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Relationships</h2>
              <p className="text-sm text-muted-foreground">
                Open a row to see the projects, quotations, orders and signals behind the summary.
              </p>
            </div>

            {data.customers.length === 0 ? (
              <EmptyState
                title="No customer accounts"
                body="Import sales or customer data to populate accounts, then attach contacts and commercial records."
              />
            ) : (
              <div className="panel divide-y divide-border">
                {data.customers.map((c) => {
                  const r = relationships.get(c.id) ?? emptyRelationship();
                  const isOpen = open === c.id;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : c.id)}
                        className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-muted"
                      >
                        {isOpen ? (
                          <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-sm font-medium text-foreground">{c.name}</span>
                            <span className="text-xs text-muted-foreground">{c.externalRef}</span>
                            {c.segment ? <Pill tone="neutral">{c.segment}</Pill> : null}
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {summarise(c.name, r)}
                          </p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-sm tabular-nums text-foreground">{money(r.openValue + r.committedValue)}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.lastActivity ? `Last activity ${r.lastActivity}` : "No dated activity"}
                          </p>
                        </div>
                      </button>

                      {isOpen ? (
                        <div className="grid gap-4 border-t border-border bg-surface-muted/60 px-3 py-4 sm:grid-cols-2">
                          <DrillDown
                            title="Live projects"
                            empty="No open projects."
                            items={r.projects.map((p) => ({
                              id: p.id,
                              primary: p.name,
                              secondary: p.stage,
                              value: p.value == null ? null : money(p.value),
                            }))}
                          />
                          <DrillDown
                            title="Open quotations"
                            empty="No open quotations."
                            items={r.quotations.map((q) => ({
                              id: q.id,
                              primary: q.label,
                              secondary: q.status,
                              value: money(q.value),
                            }))}
                          />
                          <DrillDown
                            title="Confirmed orders"
                            empty="No confirmed orders."
                            items={r.orders.map((o) => ({
                              id: o.id,
                              primary: o.label,
                              secondary: o.status,
                              value: money(o.value),
                            }))}
                          />
                          <DrillDown
                            title="Market signals"
                            empty="No signals recorded for this account."
                            items={r.signals.map((s) => ({
                              id: s.id,
                              primary: s.title,
                              secondary: `${s.impact} · ${s.observedOn}`,
                              value: null,
                            }))}
                          />
                          <p className="text-xs text-muted-foreground sm:col-span-2">
                            {r.contacts
                              ? `${num(r.contacts)} contact${r.contacts === 1 ? "" : "s"} on file for this account.`
                              : "No contacts on file for this account."}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Contacts</h2>
              <p className="text-sm text-muted-foreground">
                The people who tell you what they need. Attach them to an account to keep the trail intact.
              </p>
            </div>
            <BusinessRecordTable
              table="contacts"
              invalidate={[["business-book"]]}
              rows={data.contacts}
              newLabel="New contact"
              emptyTitle="No contacts yet"
              emptyBody="Add the people you deal with at each account."
              columns={[
                { label: "Name", render: (c) => c.name },
                { label: "Customer", render: (c) => c.customerName ?? "Unattributed" },
                { label: "Role", render: (c) => c.role ?? "—" },
                { label: "Email", render: (c) => c.email ?? "—" },
              ]}
              details={[
                { label: "Phone", render: (c) => c.phone ?? "—" },
                { label: "Notes", render: (c) => c.notes ?? "—" },
              ]}
              fields={contactFields}
              toValues={(c) => ({
                name: c.name,
                customer_id: c.customerId,
                role: c.role,
                email: c.email,
                phone: c.phone,
                notes: c.notes,
              })}
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}

function DrillDown({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { id: string; primary: string; secondary: string; value: string | null }[];
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-foreground">{i.primary}</span>
                <span className="block truncate text-xs text-muted-foreground">{i.secondary}</span>
              </span>
              {i.value ? <span className="shrink-0 tabular-nums text-muted-foreground">{i.value}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
