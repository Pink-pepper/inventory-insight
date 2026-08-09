import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Ionic Inventory Intelligence" },
      {
        name: "description",
        content:
          "Sign in to your Ionic workspace to review purchasing recommendations, stock cover and excess inventory.",
      },
      { property: "og:title", content: "Sign in — Ionic Inventory Intelligence" },
      {
        property: "og:description",
        content: "Access your company workspace for inventory and purchasing decision intelligence.",
      },
    ],
  }),
  component: AuthPage,
});

const credentials = z.object({
  email: z.string().trim().email("Enter a valid work email").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/overview", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { company_name: company.trim(), full_name: fullName.trim() },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Check your email to confirm your account.");
          return;
        }
        navigate({ to: "/data-sources", replace: true });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        navigate({ to: "/overview", replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in failed. Try email instead.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/overview", replace: true });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between bg-sidebar px-12 py-10 lg:flex">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-sm bg-sidebar-primary text-[13px] font-bold text-sidebar-primary-foreground">
            I
          </span>
          <span className="text-sm font-semibold text-sidebar-accent-foreground">Ionic</span>
        </Link>
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold leading-snug text-sidebar-accent-foreground">
            What should you buy, when, and how much?
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-sidebar-foreground/70">
            Ionic sits on top of your ERP as a decision layer. It reads sales, inventory, purchasing
            and supplier data, then tells your team exactly which SKUs need action — and shows the
            arithmetic behind every recommendation.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-6 border-t border-sidebar-border pt-6">
            {[
              ["Reorder point", "Lead time + safety"],
              ["Stock cover", "Days of demand"],
              ["Excess capital", "Tied-up value"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-sidebar-accent-foreground">{k}</dt>
                <dd className="mt-1 text-[11px] text-sidebar-foreground/60">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-[11px] text-sidebar-foreground/50">
          Multi-tenant workspace · row-level isolation · audit logged
        </p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold text-foreground">
            {mode === "signin" ? "Sign in to Ionic" : "Create your workspace"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Use your work account to access your company workspace."
              : "Set up a company workspace and start with the demo dataset."}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "signup" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company name</Label>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    maxLength={100}
                    placeholder="Northgate Distribution"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    maxLength={100}
                    placeholder="Alex Moore"
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === "signin" ? "Sign in" : "Create workspace"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={google} disabled={busy}>
            Continue with Google
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "No workspace yet?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}