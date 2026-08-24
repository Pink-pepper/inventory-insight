CREATE TYPE public.channel_kind AS ENUM ('direct_shipment','dropship','stock');
CREATE TYPE public.demand_source AS ENUM ('history','requirement','opportunity','quotation','lpo','order','market','planner');
CREATE TYPE public.demand_certainty AS ENUM ('speculative','expected','active','high_confidence','committed','confirmed','actual');
CREATE TYPE public.commercial_status AS ENUM ('open','won','lost','cancelled','expired','superseded','fulfilled');

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  email text,
  phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant contact read" ON public.contacts FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant contact insert" ON public.contacts FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant contact update" ON public.contacts FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant contact delete" ON public.contacts FOR DELETE TO authenticated USING (is_org_member(org_id));

CREATE TABLE public.requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text,
  period_start date NOT NULL,
  period_end date,
  channel public.channel_kind NOT NULL DEFAULT 'stock',
  status public.commercial_status NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.requirements TO authenticated;
GRANT ALL ON public.requirements TO service_role;
ALTER TABLE public.requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant requirement read" ON public.requirements FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant requirement insert" ON public.requirements FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant requirement update" ON public.requirements FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant requirement delete" ON public.requirements FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER requirements_touch BEFORE UPDATE ON public.requirements FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  requirement_id uuid REFERENCES public.requirements(id) ON DELETE SET NULL,
  title text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text,
  expected_period date NOT NULL,
  expected_unit_price numeric,
  currency_code text,
  probability numeric NOT NULL DEFAULT 0.5,
  channel public.channel_kind NOT NULL DEFAULT 'stock',
  status public.commercial_status NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant opportunity read" ON public.opportunities FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant opportunity insert" ON public.opportunities FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant opportunity update" ON public.opportunities FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant opportunity delete" ON public.opportunities FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER opportunities_touch BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  reference text,
  quantity numeric NOT NULL DEFAULT 0,
  unit text,
  unit_price numeric,
  currency_code text,
  expected_period date NOT NULL,
  issued_on date,
  valid_until date,
  channel public.channel_kind NOT NULL DEFAULT 'stock',
  status public.commercial_status NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotations TO authenticated;
GRANT ALL ON public.quotations TO service_role;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant quotation read" ON public.quotations FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant quotation insert" ON public.quotations FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant quotation update" ON public.quotations FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant quotation delete" ON public.quotations FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER quotations_touch BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.customer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
  reference text,
  quantity numeric NOT NULL DEFAULT 0,
  unit text,
  unit_price numeric,
  currency_code text,
  period_start date NOT NULL,
  period_end date,
  channel public.channel_kind NOT NULL DEFAULT 'stock',
  confirmation text,
  status public.commercial_status NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_orders TO authenticated;
GRANT ALL ON public.customer_orders TO service_role;
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant customer order read" ON public.customer_orders FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant customer order insert" ON public.customer_orders FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant customer order update" ON public.customer_orders FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant customer order delete" ON public.customer_orders FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER customer_orders_touch BEFORE UPDATE ON public.customer_orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.market_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  kind text NOT NULL,
  title text NOT NULL,
  detail text,
  impact text NOT NULL DEFAULT 'informational',
  observed_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_signals TO authenticated;
GRANT ALL ON public.market_signals TO service_role;
ALTER TABLE public.market_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant market signal read" ON public.market_signals FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant market signal insert" ON public.market_signals FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant market signal update" ON public.market_signals FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant market signal delete" ON public.market_signals FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER market_signals_touch BEFORE UPDATE ON public.market_signals FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.demand_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 0,
  unit text,
  expected_period date NOT NULL,
  channel public.channel_kind NOT NULL DEFAULT 'stock',
  source public.demand_source NOT NULL,
  certainty public.demand_certainty NOT NULL,
  probability numeric,
  status public.commercial_status NOT NULL DEFAULT 'open',
  unit_price numeric,
  currency_code text,
  notes text,
  source_record_type text,
  source_record_id uuid,
  supersedes_id uuid REFERENCES public.demand_signals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE INDEX demand_signals_org_period_idx ON public.demand_signals (org_id, expected_period);
CREATE INDEX demand_signals_org_product_idx ON public.demand_signals (org_id, product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_signals TO authenticated;
GRANT ALL ON public.demand_signals TO service_role;
ALTER TABLE public.demand_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant demand signal read" ON public.demand_signals FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant demand signal insert" ON public.demand_signals FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant demand signal update" ON public.demand_signals FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant demand signal delete" ON public.demand_signals FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER demand_signals_touch BEFORE UPDATE ON public.demand_signals FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();