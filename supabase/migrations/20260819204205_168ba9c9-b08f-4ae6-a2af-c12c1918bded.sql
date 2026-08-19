-- 1. Planning policies (one optional row per organisation)
CREATE TABLE public.planning_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Inventory policy
  reorder_point_override numeric,
  minimum_stock_level numeric,
  target_stock_level numeric,
  days_of_cover_target numeric,
  safety_stock_days integer,
  service_level numeric,
  -- Demand assumptions
  demand_window_months integer,
  planning_horizon_days integer,
  demand_method text,
  demand_growth_pct numeric,
  seasonality_enabled boolean,
  demand_variability numeric,
  -- Supply assumptions
  default_lead_time_days integer,
  lead_time_variability_days numeric,
  default_min_order_qty integer,
  order_multiple integer,
  -- Display preference
  product_display text NOT NULL DEFAULT 'sku_name',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planning_policies_product_display_chk
    CHECK (product_display IN ('sku', 'name', 'sku_name')),
  CONSTRAINT planning_policies_demand_method_chk
    CHECK (demand_method IS NULL OR demand_method IN ('trailing_average')),
  CONSTRAINT planning_policies_service_level_chk
    CHECK (service_level IS NULL OR (service_level >= 0 AND service_level <= 1))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.planning_policies TO authenticated;
GRANT ALL ON public.planning_policies TO service_role;
ALTER TABLE public.planning_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant policy read" ON public.planning_policies
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "tenant policy insert" ON public.planning_policies
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role]));
CREATE POLICY "tenant policy update" ON public.planning_policies
  FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role]));
CREATE POLICY "tenant policy delete" ON public.planning_policies
  FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role]));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER planning_policies_touch
  BEFORE UPDATE ON public.planning_policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Geography dimension
CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  country text,
  region text,
  state_province text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code),
  UNIQUE (org_id, id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant location read" ON public.locations
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "tenant location insert" ON public.locations
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "tenant location update" ON public.locations
  FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "tenant location delete" ON public.locations
  FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner'::org_role, 'admin'::org_role]));

-- 3. Additive columns (all nullable, existing code unaffected)
ALTER TABLE public.inventory ADD COLUMN location_id uuid;
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_org_location_fkey
  FOREIGN KEY (org_id, location_id) REFERENCES public.locations(org_id, id) ON DELETE SET NULL;

ALTER TABLE public.products ADD COLUMN unit_price numeric;
ALTER TABLE public.sales ADD COLUMN cogs numeric;

-- 4. Backfill locations from existing inventory labels
INSERT INTO public.locations (org_id, code, name)
SELECT DISTINCT i.org_id, i.location, i.location
FROM public.inventory i
ON CONFLICT (org_id, code) DO NOTHING;

UPDATE public.inventory i
SET location_id = l.id
FROM public.locations l
WHERE l.org_id = i.org_id AND l.code = i.location AND i.location_id IS NULL;