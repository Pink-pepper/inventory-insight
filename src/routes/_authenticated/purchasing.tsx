import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Check, X, RotateCcw } from "lucide-react";
import { AppShell, EmptyState, Loading, useProductLabel } from "@/components/app-shell";
import { Pill } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getPurchaseOrders, setPurchaseOrderApproval } from "@/lib/ionic.functions";
import type { PurchaseOrderRecord } from "@/lib/domain/model";
import {
  approvalLabel,
  fulfilmentLabel,
  fulfilmentStatus,
} from "@/lib/domain/purchase-order";
import { money, num } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchasing")({
  head: () => ({
    meta: [
      { title: "Purchasing — Ionic" },
      {
        name: "description",
        content:
          "Purchase order inbox: approval state, fulfilment progress, ETAs and outstanding value across every order.",
      },
      { property: "og:title", content: "Purchasing — Ionic" },
      {
        property: "og:description",
        content: "Track purchase order approvals and deliveries, and act on what is late or unreviewed.",
      },
    ],
  }),
  component: PurchasingPage,
});

type Tab = "needs_review" | "open" | "delivered" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "needs_review", label: "Needs review" },
  { id: "open", label: "Open" },
  { id: "delivered", label: "Delivered" },
  { id: "all", label: "All" },
];

function PurchasingPage() {
  const fn = useServerFn(getPurchaseOrders);
  const approveFn = useServerFn(setPurchaseOrderApproval);
  const label = useProductLabel();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("needs_review");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => fn(),
  });

  const mutation = useMutation({
    mutationFn: (input: { poId: string; approvalStatus: "approved" | "rejected" | "needs_review" }) =>
      approveFn({ data: input }),
    onSuccess: () => {
      toast.success("Purchase order updated");
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not update the purchase order.");
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const orders = data?.orders ?? [];

  const summary = useMemo(() => {
    const open = orders.filter((o) => ["open", "partially_received"].includes(fulfilmentStatus(o)));
    const overdue = open.filter((o) => o.expectedAt != null && o.expectedAt < today);
    const needsReview = orders.filter((o) => o.approvalStatus === "needs_review");
    const outstandingValue = open.reduce((sum, o) => sum + o.outstanding * o.unitCost, 0);
    return {
      openCount: open.length,
      overdueCount: overdue.length,
      needsReviewCount: needsReview.length,
      outstandingValue,
    };
  }, [orders, today]);

  const visible = useMemo(() => {
    switch (tab) {
      case "needs_review":
        return orders.filter((o) => o.approvalStatus === "needs_review");
      case "open":
        return orders.filter((o) => ["open", "partially_received"].includes(fulfilmentStatus(o)));
      case "delivered":
        return orders.filter((o) => ["delivered", "closed"].includes(fulfilmentStatus(o)));
      default:
        return orders;
    }
  }, [orders, tab]);

  return (
    <AppShell
      title="Purchasing"
      description="Purchase order visibility: what has been ordered, what is approved, what has arrived, and what is late."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/supply-planning">Supply planning</Link>
        </Button>
      }
    >
      {isLoading ? (
        <Loading label="Loading purchase orders" />
      ) : isError ? (
        <EmptyState
          title="Could not load purchase orders"
          body={error instanceof Error ? error.message : "The purchase order query did not return a result."}
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : orders.length === 0 ? (
        <EmptyState
          title="No purchase orders yet"
          body="Import purchase orders (Data Sources → Import, entity “Purchase orders”) to track approvals, ETAs and receipts here."
          action={
            <Button asChild size="sm">
              <Link to="/data-sources">Go to Data Sources</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Open orders"
              value={num(summary.openCount)}
              hint="Placed, not yet fully received"
            />
            <Metric
              label="Outstanding value"
              value={money(summary.outstandingValue)}
              hint="Open quantity × recorded unit cost"
            />
            <Metric
              label="Needs review"
              value={num(summary.needsReviewCount)}
              hint="No approval signal recorded"
            />
            <Metric
              label="Overdue"
              value={num(summary.overdueCount)}
              hint="ETA passed with quantity still open"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                {t.label}
                {t.id === "needs_review" && summary.needsReviewCount > 0 ? (
                  <span className="ml-1.5 tabular">({num(summary.needsReviewCount)})</span>
                ) : null}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="Nothing in this view"
              body={
                tab === "needs_review"
                  ? "Every purchase order has a recorded approval decision."
                  : "No purchase orders match this filter."
              }
            />
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="bg-surface-muted">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">PO</th>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Supplier</th>
                    <th className="px-3 py-2 text-right font-medium">Ordered</th>
                    <th className="px-3 py-2 text-right font-medium">Received</th>
                    <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                    <th className="px-3 py-2 font-medium">Ordered on</th>
                    <th className="px-3 py-2 font-medium">ETA</th>
                    <th className="px-3 py-2 font-medium">Delivered</th>
                    <th className="px-3 py-2 font-medium">Approval</th>
                    <th className="px-3 py-2 font-medium">Fulfilment</th>
                    {data?.canApprove ? <th className="px-3 py-2 text-right font-medium">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((po) => {
                    const fulfilment = fulfilmentStatus(po);
                    const overdue =
                      ["open", "partially_received"].includes(fulfilment) &&
                      po.expectedAt != null &&
                      po.expectedAt < today;
                    return (
                      <tr key={po.id} className="border-t border-border/70">
                        <td className="px-3 py-2.5 font-medium text-foreground">
                          {po.poNumber ?? "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {po.sku ? (
                            <Link
                              to="/sku/$sku"
                              params={{ sku: po.sku }}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {label(po.sku, po.productName ?? po.sku)}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {po.locationCode ? (
                            <span className="block text-[11px] text-muted-foreground">
                              → {po.locationName ?? po.locationCode}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{po.supplierName ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular">{num(po.quantity)}</td>
                        <td className="px-3 py-2.5 text-right tabular">{num(po.receivedQuantity)}</td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {num(po.outstanding)}
                          {po.outstanding > 0 && po.unitCost > 0 ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {money(po.outstanding * po.unitCost)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 tabular text-muted-foreground">
                          {po.orderedAt ?? "—"}
                        </td>
                        <td className={`px-3 py-2.5 tabular ${overdue ? "font-medium text-status-reorder" : "text-muted-foreground"}`}>
                          {po.expectedAt ?? "—"}
                          {overdue ? <span className="block text-[11px]">overdue</span> : null}
                        </td>
                        <td className="px-3 py-2.5 tabular text-muted-foreground">
                          {po.receivedAt ?? "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <Pill tone={APPROVAL_TONE[po.approvalStatus]}>
                            {approvalLabel(po.approvalStatus)}
                          </Pill>
                        </td>
                        <td className="px-3 py-2.5">
                          <Pill tone={FULFILMENT_TONE[fulfilment]}>{fulfilmentLabel(fulfilment)}</Pill>
                        </td>
                        {data?.canApprove ? (
                          <td className="px-3 py-2.5">
                            <div className="flex justify-end gap-1">
                              {po.approvalStatus !== "approved" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={mutation.isPending}
                                  onClick={() =>
                                    mutation.mutate({ poId: po.id, approvalStatus: "approved" })
                                  }
                                  aria-label={`Approve ${po.poNumber ?? "purchase order"}`}
                                >
                                  <Check className="size-3.5" /> Approve
                                </Button>
                              ) : null}
                              {po.approvalStatus !== "rejected" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={mutation.isPending}
                                  onClick={() =>
                                    mutation.mutate({ poId: po.id, approvalStatus: "rejected" })
                                  }
                                  aria-label={`Reject ${po.poNumber ?? "purchase order"}`}
                                >
                                  <X className="size-3.5" /> Reject
                                </Button>
                              ) : null}
                              {po.approvalStatus !== "needs_review" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={mutation.isPending}
                                  onClick={() =>
                                    mutation.mutate({ poId: po.id, approvalStatus: "needs_review" })
                                  }
                                  aria-label={`Return ${po.poNumber ?? "purchase order"} to review`}
                                >
                                  <RotateCcw className="size-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel px-4 py-4">
            <h2 className="text-sm font-semibold text-foreground">How to read this</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>
                Approval and fulfilment are independent: an order can be approved and still open, or
                fully delivered after having been rejected at intake.
              </li>
              <li>
                “Needs review” means the source data carried no approval signal. Owners and admins
                can record a decision here; members see the state read-only.
              </li>
              <li>
                Re-importing a purchase order file updates existing orders in place — receipts,
                ETAs and statuses refresh; the order is not duplicated.
              </li>
              <li>
                Open, approved quantities feed the scheduled inbound supply in{" "}
                <Link to="/supply-planning" className="text-primary underline-offset-4 hover:underline">
                  Supply planning
                </Link>
                .
              </li>
            </ul>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const APPROVAL_TONE = {
  approved: "hold",
  needs_review: "watch",
  rejected: "excess",
} as const;

const FULFILMENT_TONE = {
  open: "watch",
  partially_received: "watch",
  delivered: "hold",
  closed: "neutral",
  cancelled: "excess",
} as const;

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
