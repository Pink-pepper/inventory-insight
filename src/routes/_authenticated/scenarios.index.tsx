import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { FlaskConical, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, CardsSkeleton, EmptyState, Loading } from "@/components/app-shell";
import { ScenarioForm, type ScenarioFormValues } from "@/components/scenario-form";
import { Pill } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createScenario, deleteScenario, listScenarios } from "@/lib/ionic.functions";
import type { ScenarioRecord } from "@/lib/scenario/types";
import { hasAssumptions } from "@/lib/scenario/assumptions";

export const Route = createFileRoute("/_authenticated/scenarios/")({
  head: () => ({
    meta: [
      { title: "Scenario — Ionic" },
      {
        name: "description",
        content:
          "Test planning assumptions side by side: demand growth, lead times, safety stock and cost changes compared against your live plan without touching it.",
      },
      { property: "og:title", content: "Scenario — Ionic" },
      {
        property: "og:description",
        content:
          "Versioned what-if runs with baseline-vs-scenario comparison, from the same engines that drive the live plan.",
      },
    ],
  }),
  component: ScenariosPage,
});

const STATUS_TONE: Record<ScenarioRecord["status"], "hold" | "watch" | "neutral"> = {
  active: "hold",
  draft: "watch",
  archived: "neutral",
};

function ScenariosPage() {
  const listFn = useServerFn(listScenarios);
  const createFn = useServerFn(createScenario);
  const deleteFn = useServerFn(deleteScenario);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ScenarioRecord | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["scenarios"],
    queryFn: () => listFn(),
  });

  const createMutation = useMutation({
    mutationFn: (values: ScenarioFormValues) => createFn({ data: values }),
    onSuccess: async ({ scenario }) => {
      await queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      setCreating(false);
      toast.success(`Scenario “${scenario.name}” created`);
      navigate({ to: "/scenarios/$scenarioId", params: { scenarioId: scenario.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create the scenario."),
  });

  const deleteMutation = useMutation({
    mutationFn: (scenarioId: string) => deleteFn({ data: { scenarioId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      setConfirmDelete(null);
      toast.success("Scenario deleted with its run history");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete the scenario."),
  });

  return (
    <AppShell
      title="Scenario"
      description="Change the assumptions, not the data. Every run compares against the live plan side by side."
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          New scenario
        </Button>
      }
    >
      {isLoading ? (
        <CardsSkeleton count={3} />
      ) : isError ? (
        <EmptyState
          title="Could not load scenarios"
          body={error instanceof Error ? error.message : "The scenario query did not return a result."}
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : !data ? null : data.scenarios.length === 0 ? (
        <EmptyState
          title="No scenarios yet"
          body="A scenario changes planning assumptions — demand growth, lead times, safety stock, costs — and shows what the plan would look like under them, without touching live data or recommendations."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              Create the first scenario
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {data.scenarios.map((s) => (
            <div key={s.id} className="panel flex flex-wrap items-center gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    to="/scenarios/$scenarioId"
                    params={{ scenarioId: s.id }}
                    className="truncate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                  >
                    {s.name}
                  </Link>
                  <Pill tone={STATUS_TONE[s.status]}>{s.status}</Pill>
                </div>
                {s.description ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.description}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {hasAssumptions(s.assumptions)
                    ? `${Object.values(s.assumptions).filter((v) => v != null && (!Array.isArray(v) || v.length > 0)).length} assumption(s) set`
                    : "No assumptions set yet"}
                  {s.latestVersion != null
                    ? ` · last run v${s.latestVersion} ${new Date(s.latestRunAt!).toLocaleString()}`
                    : " · never run"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button asChild size="sm" variant="outline">
                  <Link to="/scenarios/$scenarioId" params={{ scenarioId: s.id }}>
                    <Play className="mr-1 size-3.5" /> Open
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => setConfirmDelete(s)}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="size-4" /> New scenario
            </DialogTitle>
            <DialogDescription>
              Set only what changes. Everything left empty keeps its live value, so the comparison
              isolates exactly your assumptions.
            </DialogDescription>
          </DialogHeader>
          {data ? (
            <ScenarioForm
              options={data.options}
              policy={data.policy}
              submitting={createMutation.isPending}
              submitLabel="Create scenario"
              onSubmit={(values) => createMutation.mutate(values)}
            />
          ) : (
            <Loading label="Preparing the form" />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete != null} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>
              The scenario and its entire run history are removed. Live planning data is not
              affected. Only owners and admins can delete scenarios.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete scenario"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
