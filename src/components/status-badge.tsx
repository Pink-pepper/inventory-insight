import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { RecommendationAction } from "@/lib/domain/model";

const badge = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
  {
    variants: {
      tone: {
        reorder: "border-status-reorder/25 bg-status-reorder-soft text-status-reorder",
        watch: "border-status-watch/25 bg-status-watch-soft text-status-watch",
        hold: "border-status-hold/25 bg-status-hold-soft text-status-hold",
        excess: "border-status-excess/25 bg-status-excess-soft text-status-excess",
        neutral: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const TONE: Record<RecommendationAction, NonNullable<VariantProps<typeof badge>["tone"]>> = {
  REORDER: "reorder",
  WATCH: "watch",
  HOLD: "hold",
  EXCESS: "excess",
};

const LABEL: Record<RecommendationAction, string> = {
  REORDER: "Reorder",
  WATCH: "Watch",
  HOLD: "Hold",
  EXCESS: "Excess",
};

export function StatusBadge({ action, className }: { action: RecommendationAction; className?: string }) {
  return (
    <span className={cn(badge({ tone: TONE[action] }), className)}>
      <span className="size-1.5 rounded-full bg-current" />
      {LABEL[action]}
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: NonNullable<VariantProps<typeof badge>["tone"]>;
}) {
  return <span className={badge({ tone })}>{children}</span>;
}