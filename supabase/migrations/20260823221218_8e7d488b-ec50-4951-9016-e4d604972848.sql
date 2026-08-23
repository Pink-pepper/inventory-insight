CREATE TYPE public.movement_class AS ENUM (
  'sale',
  'consumption',
  'sampling',
  'promotional',
  'service_use',
  'damage',
  'expiry',
  'quality_loss',
  'return',
  'adjustment',
  'transfer',
  'assembly',
  'other'
);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  occurred_on date NOT NULL,
  quantity numeric NOT NULL,
  movement_class public.movement_class NOT NULL DEFAULT 'other',
  source_reason text,
  location_id uuid,
  source_ref text,
  value numeric,
  currency_code text,
  original_amount numeric,
  cogs numeric,
  source_row_hash text NOT NULL,
  import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, source_row_hash),
  CONSTRAINT movements_org_product_fkey FOREIGN KEY (org_id, product_id) REFERENCES public.products(org_id, id) ON DELETE CASCADE,
  CONSTRAINT movements_org_location_fkey FOREIGN KEY (org_id, location_id) REFERENCES public.locations(org_id, id) ON DELETE SET NULL (location_id),
  CONSTRAINT movements_org_batch_fkey FOREIGN KEY (org_id, import_batch_id) REFERENCES public.import_batches(org_id, id) ON DELETE SET NULL (import_batch_id)
);
CREATE INDEX movements_org_date_idx ON public.inventory_movements (org_id, occurred_on);
CREATE INDEX movements_org_product_date_idx ON public.inventory_movements (org_id, product_id, occurred_on);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant movement read" ON public.inventory_movements FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant movement insert" ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant movement update" ON public.inventory_movements FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant movement delete" ON public.inventory_movements FOR DELETE TO authenticated USING (has_org_role(org_id, ARRAY['owner'::org_role,'admin'::org_role]));

-- Provenance backfill on existing aggregate tables: nullable, no inference for existing rows.
ALTER TABLE public.inventory ADD COLUMN import_batch_id uuid;
ALTER TABLE public.inventory ADD COLUMN source_ref text;
ALTER TABLE public.sales ADD COLUMN import_batch_id uuid;
ALTER TABLE public.sales ADD COLUMN source_ref text;
ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_org_batch_fkey FOREIGN KEY (org_id, import_batch_id)
  REFERENCES public.import_batches(org_id, id) ON DELETE SET NULL (import_batch_id);
ALTER TABLE public.sales
  ADD CONSTRAINT sales_org_batch_fkey FOREIGN KEY (org_id, import_batch_id)
  REFERENCES public.import_batches(org_id, id) ON DELETE SET NULL (import_batch_id);