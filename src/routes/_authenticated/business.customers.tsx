import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { AppShell, EmptyState, Loading } from "@/components/app-shell";
import { BusinessRecordTable, type FieldSpec } from "@/components/business-record-table";
import { getBusinessBook } from "@/lib/business.functions";
import { num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/business/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Ionic" },
      {
        name: "description",
        content:
          "Customer accounts and the people behind them, with live commercial activity for each relationship.",
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

function CustomersPage() {
  const fn = useServerFn(getBusinessBook);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["business-book"],
    queryFn: () => fn(),
  });

  /** Activity per account, so the relationship reads as a relationship. */
  const activity = useMemo(() => {
    const map = new Map<string, { open: number; committed: number; contacts: number }>();
    if (!data) return map;
    const bump = (id: string | null, key: "open" | "committed" | "contacts") => {
      if (!id) return;
      const row = map.get(id) ?? { open: 0, committed: 0, contacts: 0 };
      row[key] += 1;
      map.set(id, row);
    };
    for (const c of data.contacts) bump(c.customerId, "contacts");
    for (const r of data.requirements) bump(r.customerId, "open");
    for (const o of data.opportunities) bump(o.customerId, "open");
    for (const q of data.quotations) bump(q.customerId, "open");
    for (const c of data.customerOrders) bump(c.customerId, "committed");
    return map;
  }, [data]);

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
      description="Accounts, the people you deal with, and the business currently attached to each relationship."
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
              <h2 className="text-sm font-semibold text-foreground">Accounts</h2>
              <p className="text-sm text-muted-foreground">
                Accounts come from your imported data. Add commercial records against them in the Pipeline.
              </p>
            </div>

            {data.customers.length === 0 ? (
              <EmptyState
                title="No customer accounts"
                body="Import sales or customer data to populate accounts, then attach contacts and pipeline records."
              />
            ) : (
              <div className="panel divide-y divide-border">
                <div className="grid grid-cols-[2fr_1fr_repeat(3,minmax(0,1fr))] gap-3 bg-surface-muted px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Customer</span>
                  <span>Segment</span>
                  <span className="text-right">Contacts</span>
                  <span className="text-right">Open records</span>
                  <span className="text-right">Committed orders</span>
                </div>
                {data.customers.map((c) => {
                  const a = activity.get(c.id) ?? { open: 0, committed: 0, contacts: 0 };
                  return (
                    <div
                      key={c.id}
                      className="grid grid-cols-[2fr_1fr_repeat(3,minmax(0,1fr))] items-center gap-3 px-3 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.externalRef}</p>
                      </div>
                      <span className="truncate text-muted-foreground">{c.segment ?? "—"}</span>
                      <span className="text-right tabular-nums">{num(a.contacts)}</span>
                      <span className="text-right tabular-nums">{num(a.open)}</span>
                      <span className="text-right tabular-nums">{num(a.committed)}</span>
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
