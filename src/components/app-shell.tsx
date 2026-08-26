import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  LayoutDashboard,
  Boxes,
  TrendingUp,
  Truck,
  ShoppingCart,
  ArrowLeftRight,
  FlaskConical,
  ClipboardList,
  Database,
  Settings,
  LogOut,
  Loader2,
  BookOpen,
  Handshake,
  Users,
  Radar,
  Ship,
  PackageCheck,
  Coins,
  Briefcase,
  Package,
  Factory,
  Target,
} from "lucide-react";


import { supabase } from "@/integrations/supabase/client";
import { getWorkspace } from "@/lib/ionic.functions";
import { formatProductLabel } from "@/lib/domain/planning-policy";
import { cn } from "@/lib/utils";

/**
 * Navigation follows the distributor's working order: what the business has
 * sold or is about to sell, then what that means for stock and supply.
 * Landed Costs is deliberately absent — it is reached contextually from
 * Procurement, Products, Shipments and purchase orders.
 */
type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Reachable, but not yet a finished module. */
  soon?: boolean;
};

type NavGroup = { label: string | null; items: NavItem[]; collapsible?: boolean };

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ to: "/overview", label: "Control Tower", icon: LayoutDashboard }],
  },
  {
    label: "Business",
    collapsible: true,
    items: [
      { to: "/business/customers", label: "Customers", icon: Users },
      { to: "/projects", label: "Projects", icon: Briefcase },
      { to: "/business", label: "Demand Book", icon: BookOpen },
      { to: "/business/signals", label: "Market Signals", icon: Radar },
    ],
  },
  {
    label: "Inventory",
    collapsible: true,
    items: [
      { to: "/inventory", label: "Inventory", icon: Boxes },
      { to: "/master/products", label: "Products", icon: Package },
      { to: "/master/suppliers", label: "Suppliers", icon: Factory },
    ],
  },
  {
    label: "Planning",
    items: [
      { to: "/demand-planning", label: "Demand Plan", icon: TrendingUp },
      { to: "/supply-planning", label: "Supply Plan", icon: Truck },
      { to: "/business-plan", label: "Business Plan", icon: Target },
      { to: "/scenarios", label: "Scenarios", icon: FlaskConical },
      { to: "/distribution", label: "Distribution", icon: ArrowLeftRight, soon: true },
    ],
  },
  {
    label: "Supply",
    items: [
      { to: "/purchasing", label: "Procurement", icon: ShoppingCart },
      { to: "/supply", label: "Shipments", icon: Ship },
      { to: "/supply/inbound", label: "Inbound", icon: PackageCheck },
    ],
  },
  {
    label: "Analytics",
    items: [{ to: "/recommendations", label: "Analytics", icon: ClipboardList }],
  },
  {
    label: "Data",
    items: [
      { to: "/data-sources", label: "Data Hub", icon: Database },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];


const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function useWorkspace() {
  const fn = useServerFn(getWorkspace);
  return useQuery({
    queryKey: ["workspace"],
    retry: false,
    queryFn: async () => {
      // The server function requires a bearer token. During sign-out (and
      // before the Supabase session hydrates) there is none, so skip the call
      // instead of surfacing a 401 as a fatal error boundary.
      const { data } = await supabase.auth.getSession();
      if (!data.session) return null;
      return fn();
    },
  });
}

/**
 * Single place that decides how a product is labelled, driven by the
 * organisation's display preference. Screens call this instead of formatting
 * SKU and name themselves.
 */
export function useProductLabel() {
  const { data } = useWorkspace();
  const display = data?.planningPolicy.productDisplay ?? "sku_name";
  return (sku: string, name: string) => formatProductLabel(display, sku, name);
}

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { data } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const initials = (data?.profile.name || data?.profile.email || "?")
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <div className="flex size-6 items-center justify-center rounded-sm bg-sidebar-primary text-[13px] font-bold text-sidebar-primary-foreground">
            I
          </div>
          <span className="text-sm font-semibold tracking-tight text-sidebar-accent-foreground">Ionic</span>
        </div>

        <div className="border-b border-sidebar-border px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
            Workspace
          </p>
          <p className="mt-1 truncate text-sm font-medium text-sidebar-accent-foreground">
            {data?.org.name ?? "…"}
          </p>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV_GROUPS.map((group, i) => {
            const collapsed = group.label ? closed.includes(group.label) : false;
            return (
              <div key={group.label ?? `group-${i}`} className="space-y-0.5">
                {group.label ? (
                  group.collapsible ? (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label!)}
                      aria-expanded={!collapsed}
                      className="flex w-full items-center gap-1 px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/45 hover:text-sidebar-accent-foreground"
                    >
                      <ChevronDown
                        className={cn("size-3 transition-transform", collapsed && "-rotate-90")}
                      />
                      {group.label}
                    </button>
                  ) : (
                    <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/45">
                      {group.label}
                    </p>
                  )
                ) : null}
                {collapsed
                  ? null
                  : group.items.map((item) => {
                      const active =
                        pathname === item.to ||
                        (item.to !== "/business" && pathname.startsWith(item.to + "/"));
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={cn(
                            "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors",
                            active
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <item.icon className="size-4" />
                          <span className="flex-1">{item.label}</span>
                          {item.soon ? (
                            <span className="rounded-sm bg-sidebar-accent/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sidebar-foreground/70">
                              Soon
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
              </div>
            );
          })}

        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 px-1.5 py-1.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-semibold text-sidebar-accent-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-sidebar-accent-foreground">
                {data?.profile.name || "Account"}
              </p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">{data?.role}</p>
            </div>
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="rounded-sm p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-3 border-b border-border bg-surface px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 py-2 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-sm px-2.5 py-1.5 text-xs font-medium text-muted-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  );
}

/** Skeleton placeholder for data-heavy sections. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-sm bg-muted", className)} />;
}

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="panel divide-y divide-border" aria-busy="true" aria-label="Loading data">
      <div className="flex gap-4 bg-surface-muted px-3 py-2.5">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-3 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-3.5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel px-4 py-3.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-6 w-20" />
          <Skeleton className="mt-2.5 h-2.5 w-28" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
      <Database className="size-6 text-muted-foreground" />
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}