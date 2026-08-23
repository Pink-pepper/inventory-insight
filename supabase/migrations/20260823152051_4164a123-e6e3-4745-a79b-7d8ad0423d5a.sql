CREATE TABLE public.scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenarios TO authenticated;
GRANT ALL ON public.scenarios TO service_role;

ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view scenarios" ON public.scenarios FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "Members can create scenarios" ON public.scenarios FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id) AND created_by = auth.uid());
CREATE POLICY "Members can update scenarios" ON public.scenarios FOR UPDATE TO authenticated USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "Owners and admins can delete scenarios" ON public.scenarios FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

CREATE TRIGGER scenarios_touch BEFORE UPDATE ON public.scenarios FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.scenario_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  scenario_id uuid NOT NULL,
  version integer NOT NULL,
  assumptions jsonb NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_summary jsonb NOT NULL,
  scenario_summary jsonb NOT NULL,
  row_results jsonb NOT NULL,
  input_provenance jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, version),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, scenario_id) REFERENCES public.scenarios (org_id, id) ON DELETE CASCADE
);

GRANT SELECT, INSERT ON public.scenario_runs TO authenticated;
GRANT ALL ON public.scenario_runs TO service_role;

ALTER TABLE public.scenario_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view scenario runs" ON public.scenario_runs FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "Members can record scenario runs" ON public.scenario_runs FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id) AND created_by = auth.uid());