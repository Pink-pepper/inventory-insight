-- Customers
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_ref text NOT NULL,
  name text NOT NULL,
  segment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_ref),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant customer read" ON public.customers FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant customer insert" ON public.customers FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant customer update" ON public.customers FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant customer delete" ON public.customers FOR DELETE TO authenticated USING (has_org_role(org_id, ARRAY['owner'::org_role,'admin'::org_role]));

-- Channels
CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT ALL ON public.channels TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant channel read" ON public.channels FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant channel insert" ON public.channels FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant channel update" ON public.channels FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant channel delete" ON public.channels FOR DELETE TO authenticated USING (has_org_role(org_id, ARRAY['owner'::org_role,'admin'::org_role]));

-- Import batches (provenance for every spreadsheet import)
CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'csv',
  filename text NOT NULL,
  sheet_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  rows_read integer NOT NULL DEFAULT 0,
  rows_accepted integer NOT NULL DEFAULT 0,
  rows_rejected integer NOT NULL DEFAULT 0,
  warnings integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant batch read" ON public.import_batches FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant batch insert" ON public.import_batches FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id) AND created_by = auth.uid());

-- Day-grain demand fact
CREATE TABLE public.sales_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  occurred_on date NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  value numeric,
  unit_price numeric,
  cogs numeric,
  customer_id uuid,
  channel_id uuid,
  location_id uuid,
  region text,
  state_province text,
  currency_code text,
  original_amount numeric,
  source_ref text,
  source_row_hash text NOT NULL,
  import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_tx_org_product_fkey FOREIGN KEY (org_id, product_id) REFERENCES public.products(org_id, id) ON DELETE CASCADE,
  CONSTRAINT sales_tx_org_customer_fkey FOREIGN KEY (org_id, customer_id) REFERENCES public.customers(org_id, id) ON DELETE SET NULL,
  CONSTRAINT sales_tx_org_channel_fkey FOREIGN KEY (org_id, channel_id) REFERENCES public.channels(org_id, id) ON DELETE SET NULL,
  CONSTRAINT sales_tx_org_location_fkey FOREIGN KEY (org_id, location_id) REFERENCES public.locations(org_id, id) ON DELETE SET NULL,
  CONSTRAINT sales_tx_org_batch_fkey FOREIGN KEY (org_id, import_batch_id) REFERENCES public.import_batches(org_id, id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX sales_tx_source_ref_key ON public.sales_transactions (org_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX sales_tx_org_date_idx ON public.sales_transactions (org_id, occurred_on);
CREATE INDEX sales_tx_org_product_date_idx ON public.sales_transactions (org_id, product_id, occurred_on);
CREATE INDEX sales_tx_org_hash_idx ON public.sales_transactions (org_id, source_row_hash);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_transactions TO authenticated;
GRANT ALL ON public.sales_transactions TO service_role;
ALTER TABLE public.sales_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant tx read" ON public.sales_transactions FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant tx insert" ON public.sales_transactions FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant tx update" ON public.sales_transactions FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant tx delete" ON public.sales_transactions FOR DELETE TO authenticated USING (has_org_role(org_id, ARRAY['owner'::org_role,'admin'::org_role]));