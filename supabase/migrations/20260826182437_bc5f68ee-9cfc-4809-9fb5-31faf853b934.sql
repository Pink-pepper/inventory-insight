-- Projects: active commercial work with a customer
CREATE TYPE project_stage AS ENUM (
  'identified','engaged','requirement_confirmed','rfq','sampling','negotiation',
  'customer_decision','won','fulfilment','delivered','lost'
);

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  name text NOT NULL,
  stage project_stage NOT NULL DEFAULT 'identified',
  status commercial_status NOT NULL DEFAULT 'open',
  expected_value numeric,
  currency_code text,
  expected_close date,
  owner text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant project read" ON public.projects FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant project insert" ON public.projects FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant project update" ON public.projects FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant project delete" ON public.projects FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER projects_touch BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX projects_org_stage_idx ON public.projects (org_id, stage);

CREATE TABLE public.project_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity numeric,
  unit text,
  expected_unit_price numeric,
  currency_code text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_products TO authenticated;
GRANT ALL ON public.project_products TO service_role;
ALTER TABLE public.project_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant project_product read" ON public.project_products FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant project_product insert" ON public.project_products FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant project_product update" ON public.project_products FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant project_product delete" ON public.project_products FOR DELETE TO authenticated USING (is_org_member(org_id));

CREATE TABLE public.project_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL,
  summary text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_activities TO authenticated;
GRANT ALL ON public.project_activities TO service_role;
ALTER TABLE public.project_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant project_activity read" ON public.project_activities FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant project_activity insert" ON public.project_activities FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant project_activity update" ON public.project_activities FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant project_activity delete" ON public.project_activities FOR DELETE TO authenticated USING (is_org_member(org_id));

-- Link existing commercial records to a project without duplicating demand
ALTER TABLE public.requirements ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.opportunities ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.quotations ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.customer_orders ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- Customer order fulfilment
ALTER TABLE public.customer_orders ADD COLUMN delivered_quantity numeric NOT NULL DEFAULT 0;
ALTER TABLE public.customer_orders ADD COLUMN ordered_on date;
ALTER TABLE public.customer_orders ADD COLUMN delivered_on date;

-- Product packaging + information master data
ALTER TABLE public.products ADD COLUMN pack_size numeric;
ALTER TABLE public.products ADD COLUMN pack_uom text;
ALTER TABLE public.products ADD COLUMN specification text;
ALTER TABLE public.products ADD COLUMN regulatory_notes text;
ALTER TABLE public.products ADD COLUMN is_hazardous boolean;

-- Supplier reference data
ALTER TABLE public.suppliers ADD COLUMN country text;
ALTER TABLE public.suppliers ADD COLUMN payment_terms text;
ALTER TABLE public.suppliers ADD COLUMN incoterm text;
ALTER TABLE public.suppliers ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.suppliers ADD COLUMN notes text;

-- Display currency (presentation only; source amounts are never overwritten)
ALTER TABLE public.planning_policies ADD COLUMN display_currency text;
ALTER TABLE public.planning_policies ADD COLUMN fx_rates jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Business plan
CREATE TABLE public.business_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  plan_year integer NOT NULL,
  direction text NOT NULL DEFAULT 'bottom_up',
  revenue_target numeric NOT NULL DEFAULT 0,
  gross_profit_target numeric NOT NULL DEFAULT 0,
  currency_code text,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_plans TO authenticated;
GRANT ALL ON public.business_plans TO service_role;
ALTER TABLE public.business_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant business_plan read" ON public.business_plans FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant business_plan insert" ON public.business_plans FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant business_plan update" ON public.business_plans FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant business_plan delete" ON public.business_plans FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER business_plans_touch BEFORE UPDATE ON public.business_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.business_plan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.business_plans(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  label text,
  expected_quantity numeric NOT NULL DEFAULT 0,
  expected_revenue numeric NOT NULL DEFAULT 0,
  expected_gross_profit numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_plan_lines TO authenticated;
GRANT ALL ON public.business_plan_lines TO service_role;
ALTER TABLE public.business_plan_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant business_plan_line read" ON public.business_plan_lines FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant business_plan_line insert" ON public.business_plan_lines FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant business_plan_line update" ON public.business_plan_lines FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant business_plan_line delete" ON public.business_plan_lines FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER business_plan_lines_touch BEFORE UPDATE ON public.business_plan_lines FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX business_plan_lines_plan_idx ON public.business_plan_lines (org_id, plan_id);