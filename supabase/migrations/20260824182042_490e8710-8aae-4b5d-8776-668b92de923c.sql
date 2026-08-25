CREATE TYPE public.shipment_status AS ENUM ('planned','booked','in_transit','arrived','clearing','cleared','delivered','cancelled');
CREATE TYPE public.cost_component_kind AS ENUM ('freight','duty','clearance','other','fx');
CREATE TYPE public.cost_basis AS ENUM ('per_unit','per_shipment','percent_of_value');

CREATE TABLE public.supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_price numeric,
  currency_code text,
  min_order_qty integer,
  lead_time_days integer,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, supplier_id, product_id),
  FOREIGN KEY (org_id, supplier_id) REFERENCES public.suppliers(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, product_id) REFERENCES public.products(org_id, id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_products TO authenticated;
GRANT ALL ON public.supplier_products TO service_role;
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant supplier_product read" ON public.supplier_products FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant supplier_product insert" ON public.supplier_products FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant supplier_product update" ON public.supplier_products FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant supplier_product delete" ON public.supplier_products FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER supplier_products_touch BEFORE UPDATE ON public.supplier_products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  reference text NOT NULL,
  mode text,
  status public.shipment_status NOT NULL DEFAULT 'planned',
  etd date,
  eta date,
  revised_eta date,
  arrived_on date,
  cleared_on date,
  delivered_on date,
  incoterm text,
  currency_code text,
  fx_rate numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, supplier_id) REFERENCES public.suppliers(org_id, id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, location_id) REFERENCES public.locations(org_id, id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant shipment read" ON public.shipments FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant shipment insert" ON public.shipments FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant shipment update" ON public.shipments FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant shipment delete" ON public.shipments FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER shipments_touch BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.shipment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, shipment_id) REFERENCES public.shipments(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, product_id) REFERENCES public.products(org_id, id) ON DELETE SET NULL
);
CREATE INDEX shipment_lines_shipment_idx ON public.shipment_lines (org_id, shipment_id);
CREATE INDEX shipment_lines_po_idx ON public.shipment_lines (org_id, purchase_order_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_lines TO authenticated;
GRANT ALL ON public.shipment_lines TO service_role;
ALTER TABLE public.shipment_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant shipment_line read" ON public.shipment_lines FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant shipment_line insert" ON public.shipment_lines FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant shipment_line update" ON public.shipment_lines FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant shipment_line delete" ON public.shipment_lines FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER shipment_lines_touch BEFORE UPDATE ON public.shipment_lines FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.cost_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  kind public.cost_component_kind NOT NULL,
  label text,
  amount numeric NOT NULL DEFAULT 0,
  basis public.cost_basis NOT NULL DEFAULT 'per_unit',
  currency_code text,
  effective_from date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES public.products(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, supplier_id) REFERENCES public.suppliers(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, shipment_id) REFERENCES public.shipments(org_id, id) ON DELETE CASCADE
);
CREATE INDEX cost_components_product_idx ON public.cost_components (org_id, product_id);
CREATE INDEX cost_components_shipment_idx ON public.cost_components (org_id, shipment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_components TO authenticated;
GRANT ALL ON public.cost_components TO service_role;
ALTER TABLE public.cost_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant cost_component read" ON public.cost_components FOR SELECT TO authenticated USING (is_org_member(org_id));
CREATE POLICY "tenant cost_component insert" ON public.cost_components FOR INSERT TO authenticated WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant cost_component update" ON public.cost_components FOR UPDATE TO authenticated USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY "tenant cost_component delete" ON public.cost_components FOR DELETE TO authenticated USING (is_org_member(org_id));
CREATE TRIGGER cost_components_touch BEFORE UPDATE ON public.cost_components FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();