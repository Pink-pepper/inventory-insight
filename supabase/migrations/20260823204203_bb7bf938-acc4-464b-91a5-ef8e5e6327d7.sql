CREATE TABLE public.demand_forecasts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  product_id uuid NOT NULL,
  location_id uuid NULL,
  period_month date NOT NULL,
  baseline_qty numeric NOT NULL,
  low_qty numeric NULL,
  high_qty numeric NULL,
  method text NULL,
  source_ref text NULL,
  source_row_hash text NOT NULL,
  import_batch_id uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_forecasts_org_product_fkey FOREIGN KEY (org_id, product_id)
    REFERENCES public.products (org_id, id) ON DELETE CASCADE,
  CONSTRAINT demand_forecasts_org_location_fkey FOREIGN KEY (org_id, location_id)
    REFERENCES public.locations (org_id, id) ON DELETE SET NULL (location_id),
  CONSTRAINT demand_forecasts_org_batch_fkey FOREIGN KEY (org_id, import_batch_id)
    REFERENCES public.import_batches (org_id, id) ON DELETE SET NULL (import_batch_id),
  CONSTRAINT demand_forecasts_org_hash_unique UNIQUE (org_id, source_row_hash),
  CONSTRAINT demand_forecasts_qty_bounds CHECK (baseline_qty >= 0 AND (low_qty IS NULL OR low_qty >= 0) AND (high_qty IS NULL OR high_qty >= 0))
);

CREATE INDEX demand_forecasts_org_product_period_idx ON public.demand_forecasts (org_id, product_id, period_month);
CREATE INDEX demand_forecasts_org_batch_idx ON public.demand_forecasts (org_id, import_batch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_forecasts TO authenticated;
GRANT ALL ON public.demand_forecasts TO service_role;

ALTER TABLE public.demand_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant forecast read" ON public.demand_forecasts
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

CREATE POLICY "tenant forecast insert" ON public.demand_forecasts
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "tenant forecast update" ON public.demand_forecasts
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "tenant forecast delete" ON public.demand_forecasts
  FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner'::public.org_role, 'admin'::public.org_role]));