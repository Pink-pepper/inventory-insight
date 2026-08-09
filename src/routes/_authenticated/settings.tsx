import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Loading, useWorkspace } from "@/components/app-shell";
import { Pill } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { clearWorkspaceData, getAuditLog } from "@/lib/ionic.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Workspace settings — Ionic" },
      {
        name: "description",
        content:
          "Manage your Ionic workspace: organization details, your role, tenant isolation and stored data.",
      },
      { property: "og:title", content: "Workspace settings — Ionic" },
      {
        property: "og:description",
        content: "Organization details, roles, tenant isolation and data controls.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data, isLoading } = useWorkspace();
  const auditFn = useServerFn(getAuditLog);
  const clearFn = useServerFn(clearWorkspaceData);
  const queryClient = useQueryClient();
  const { data: auditLog } = useQuery({ queryKey: ["audit"], queryFn: () => auditFn() });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const canManage = data?.role === "owner" || data?.role === "admin";

  async function clearAll() {
    setBusy(true);
    try {
      await clearFn({});
      await queryClient.invalidateQueries();
      toast.success("Workspace data deleted");
      setConfirming(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete data");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Settings" description="Workspace, access and data controls.">
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Organization</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{data.org.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Workspace ID</dt>
                <dd className="font-mono text-xs">{data.org.slug}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Products stored</dt>
                <dd className="tabular">{data.productCount}</dd>
              </div>
            </dl>
          </section>

          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Your access</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Signed in as</dt>
                <dd className="font-medium">{data.profile.email}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Role</dt>
                <dd>
                  <Pill tone="hold">{data.role}</Pill>
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Owners and admins can ingest and delete data. Members and viewers have read access to
              recommendations. Every query is scoped to this workspace by row-level security in the
              database — a user can never read another tenant's rows, even with a crafted request.
            </p>
          </section>

          <section className="panel p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold">Decision policy</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Recommendations use transparent rules, not a black-box model. Demand is a trailing
              6-month average; the reorder point is lead-time demand plus a per-SKU safety buffer;
              order quantities target lead time plus a 30-day review period and are rounded up to the
              supplier MOQ. Anything holding more than 90 days of forward cover is flagged as excess.
            </p>
          </section>

          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <ul className="mt-3 space-y-2 text-xs">
              {(auditLog ?? []).slice(0, 8).map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span className="font-mono text-muted-foreground">{a.event}</span>
                  <span className="text-muted-foreground tabular">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
              {(auditLog ?? []).length === 0 ? (
                <li className="text-muted-foreground">No activity yet.</li>
              ) : null}
            </ul>
          </section>

          <section className="panel border-destructive/30 p-5">
            <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Permanently delete all products, suppliers, inventory, sales history and
              recommendations in this workspace. Your account and organization remain.
            </p>
            {confirming ? (
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="destructive" onClick={clearAll} disabled={busy}>
                  {busy ? "Deleting…" : "Yes, delete everything"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                className="mt-4"
                size="sm"
                variant="outline"
                disabled={!canManage}
                onClick={() => setConfirming(true)}
              >
                Delete workspace data
              </Button>
            )}
            {!canManage ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Only owners and admins can delete workspace data.
              </p>
            ) : null}
          </section>
        </div>
      )}
    </AppShell>
  );
}