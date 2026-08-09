
-- ENUMS
CREATE TYPE public.org_role AS ENUM ('owner','admin','member');
CREATE TYPE public.rec_action AS ENUM ('REORDER','WATCH','HOLD','EXCESS');
CREATE TYPE public.connector_type AS ENUM ('csv','odoo','sap','dynamics','netsuite','custom_api');
CREATE TYPE public.po_status AS ENUM ('draft','placed','received','cancelled');

-- ORGANIZATIONS
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- MEMBERSHIPS
CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
GRANT SELECT ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own memberships read" ON public.memberships FOR SELECT TO authenticated USING (user_id = auth.uid());

-- HELPERS
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships m WHERE m.org_id = _org_id AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org_id uuid, _roles public.org_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships m WHERE m.org_id = _org_id AND m.user_id = auth.uid() AND m.role = ANY(_roles));
$$;

CREATE POLICY "member org read" ON public.organizations FOR SELECT TO authenticated USING (public.is_org_member(id));
CREATE POLICY "admin org update" ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_org_role(id, ARRAY['owner','admin']::public.org_role[]))
  WITH CHECK (public.has_org_role(id, ARRAY['owner','admin']::public.org_role[]));

-- SUPPLIERS
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_ref text,
  name text NOT NULL,
  code text,
  lead_time_days integer NOT NULL DEFAULT 14,
  min_order_qty integer NOT NULL DEFAULT 1,
  reliability numeric NOT NULL DEFAULT 0.95,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

-- PRODUCTS
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Uncategorised',
  unit_cost numeric NOT NULL DEFAULT 0,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  lead_time_days integer,
  min_order_qty integer,
  safety_stock_days integer NOT NULL DEFAULT 14,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, sku)
);

-- INVENTORY
CREATE TABLE public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  on_hand numeric NOT NULL DEFAULT 0,
  on_order numeric NOT NULL DEFAULT 0,
  location text NOT NULL DEFAULT 'MAIN',
  as_of date NOT NULL DEFAULT current_date,
  UNIQUE (org_id, product_id, location)
);

-- SALES
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  UNIQUE (org_id, product_id, period_month)
);

-- PURCHASE ORDERS
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  status public.po_status NOT NULL DEFAULT 'draft',
  expected_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- DATA SOURCES
CREATE TABLE public.data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connector public.connector_type NOT NULL DEFAULT 'csv',
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_sync_at timestamptz,
  rows_ingested integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RECOMMENDATIONS
CREATE TABLE public.recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  action public.rec_action NOT NULL,
  recommended_qty numeric NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  avg_monthly_demand numeric NOT NULL DEFAULT 0,
  avg_daily_demand numeric NOT NULL DEFAULT 0,
  days_of_cover numeric NOT NULL DEFAULT 0,
  safety_stock numeric NOT NULL DEFAULT 0,
  reorder_point numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_id)
);

-- AUDIT LOG
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- GRANTS + RLS for tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers','products','inventory','sales','purchase_orders','data_sources','recommendations'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY "tenant read" ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id));', t);
    EXECUTE format('CREATE POLICY "tenant insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));', t);
    EXECUTE format('CREATE POLICY "tenant update" ON public.%I FOR UPDATE TO authenticated USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));', t);
    EXECUTE format('CREATE POLICY "tenant delete" ON public.%I FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'']::public.org_role[]));', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant audit read" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "tenant audit insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id) AND user_id = auth.uid());

CREATE INDEX idx_products_org ON public.products(org_id);
CREATE INDEX idx_sales_org_product ON public.sales(org_id, product_id);
CREATE INDEX idx_inventory_org_product ON public.inventory(org_id, product_id);
CREATE INDEX idx_recs_org ON public.recommendations(org_id);
CREATE INDEX idx_audit_org ON public.audit_logs(org_id, created_at DESC);

-- NEW USER BOOTSTRAP: profile + org + owner membership
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org_id uuid;
  company text;
  base_slug text;
  final_slug text;
  n integer := 0;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));

  company := COALESCE(NULLIF(NEW.raw_user_meta_data->>'company_name',''), split_part(NEW.email,'@',1) || ' Distribution');
  base_slug := regexp_replace(lower(company), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  IF base_slug = '' THEN base_slug := 'workspace'; END IF;
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.organizations o WHERE o.slug = final_slug) LOOP
    n := n + 1;
    final_slug := base_slug || '-' || n::text;
  END LOOP;

  INSERT INTO public.organizations (name, slug) VALUES (company, final_slug) RETURNING id INTO new_org_id;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (new_org_id, NEW.id, 'owner');
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
