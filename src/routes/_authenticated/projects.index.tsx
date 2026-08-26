import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { AppShell, TableSkeleton } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getProjects, removeProject, saveProjectRecord } from "@/lib/projects.functions";
import { getBusinessBook } from "@/lib/business.functions";
import {
  PROJECT_STAGES,
  STAGE_LABEL,
  isActiveStage,
  projectValue,
  type ProjectStage,
} from "@/lib/domain/project";
import { money } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — Ionic" },
      {
        name: "description",
        content:
          "Track customer projects from first contact to delivery, with the requirements, quotations and orders attached to each one.",
      },
      { property: "og:title", content: "Projects — Ionic" },
      {
        property: "og:description",
        content: "Customer projects, stages and expected value in one working list.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const list = useServerFn(getProjects);
  const book = useServerFn(getBusinessBook);
  const save = useServerFn(saveProjectRecord);
  const del = useServerFn(removeProject);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => list() });
  const business = useQuery({ queryKey: ["business-book"], queryFn: () => book() });

  const saveMut = useMutation({
    mutationFn: (values: Parameters<typeof save>[0]) => save(values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
    },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const rows = useMemo(
    () => (projects.data ?? []).filter((p) => showClosed || isActiveStage(p.stage)),
    [projects.data, showClosed],
  );

  const customers = business.data?.customers ?? [];

  return (
    <AppShell
      title="Projects"
      description="Real work with a customer. Requirements, quotations and orders link here — they are never duplicated."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Hide closed" : "Show closed"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" /> New project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New project</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const expected = String(f.get("expected_value") ?? "").trim();
                  saveMut.mutate({
                    data: {
                      values: {
                        name: String(f.get("name") ?? ""),
                        stage: String(f.get("stage") ?? "identified") as ProjectStage,
                        customer_id: (String(f.get("customer_id") ?? "") || null) as string | null,
                        owner: (String(f.get("owner") ?? "") || null) as string | null,
                        expected_value: expected ? Number(expected) : null,
                        expected_close:
                          (String(f.get("expected_close") ?? "") || null) as string | null,
                        notes: (String(f.get("notes") ?? "") || null) as string | null,
                      },
                    },
                  });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="name">Project name</Label>
                  <Input id="name" name="name" required maxLength={200} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="customer_id">Customer</Label>
                    <select
                      id="customer_id"
                      name="customer_id"
                      className="h-9 w-full rounded-sm border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="">Unassigned</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="stage">Stage</Label>
                    <select
                      id="stage"
                      name="stage"
                      className="h-9 w-full rounded-sm border border-input bg-transparent px-2 text-sm"
                    >
                      {PROJECT_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expected_value">Expected value</Label>
                    <Input id="expected_value" name="expected_value" type="number" min="0" step="0.01" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expected_close">Expected close</Label>
                    <Input id="expected_close" name="expected_close" type="date" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="owner">Owner</Label>
                    <Input id="owner" name="owner" maxLength={120} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Input id="notes" name="notes" maxLength={4000} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saveMut.isPending}>
                    Create project
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {projects.isLoading ? (
        <TableSkeleton columns={6} />
      ) : rows.length === 0 ? (
        <div className="panel p-10 text-center text-sm text-muted-foreground">
          No projects yet. Create one to group the commercial records for a customer opportunity.
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Project</th>
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Stage</th>
                <th className="px-3 py-2.5 font-medium">Products</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th>
                <th className="px-3 py-2.5 font-medium">Close</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => {
                const value = projectValue(p);
                return (
                  <tr key={p.id} className="hover:bg-surface-muted/60">
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {p.customerName ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">{STAGE_LABEL[p.stage]}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{p.products.length}</td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {value == null ? "—" : money(value)}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{p.expectedClose ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        aria-label={`Delete ${p.name}`}
                        className="rounded-sm p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                        onClick={() => delMut.mutate(p.id)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
