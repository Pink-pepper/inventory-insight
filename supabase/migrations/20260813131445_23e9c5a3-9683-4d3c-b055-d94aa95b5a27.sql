-- 1. Least privilege: remove table-level DML from the anonymous role.
REVOKE ALL ON public.organizations, public.profiles, public.memberships,
  public.suppliers, public.products, public.inventory, public.sales,
  public.purchase_orders, public.data_sources, public.recommendations,
  public.audit_logs FROM anon;

-- Keep the roles the policies actually target.
GRANT SELECT ON public.organizations, public.profiles, public.memberships TO authenticated;
GRANT UPDATE ON public.organizations, public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers, public.products,
  public.inventory, public.sales, public.purchase_orders, public.data_sources,
  public.recommendations TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.organizations, public.profiles, public.memberships,
  public.suppliers, public.products, public.inventory, public.sales,
  public.purchase_orders, public.data_sources, public.recommendations,
  public.audit_logs TO service_role;

-- 2. Audit records must always carry a tenant and an actor.
ALTER TABLE public.audit_logs
  ALTER COLUMN org_id SET NOT NULL,
  ALTER COLUMN user_id SET NOT NULL;

-- 3. Composite foreign keys so a row can never reference another tenant's
--    product or supplier, even though its own org_id passes RLS.
ALTER TABLE public.products ADD CONSTRAINT products_org_id_id_key UNIQUE (org_id, id);
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_org_id_id_key UNIQUE (org_id, id);

ALTER TABLE public.products DROP CONSTRAINT products_supplier_id_fkey;
ALTER TABLE public.products ADD CONSTRAINT products_org_supplier_fkey
  FOREIGN KEY (org_id, supplier_id) REFERENCES public.suppliers (org_id, id) ON DELETE SET NULL;

ALTER TABLE public.inventory DROP CONSTRAINT inventory_product_id_fkey;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_org_product_fkey
  FOREIGN KEY (org_id, product_id) REFERENCES public.products (org_id, id) ON DELETE CASCADE;

ALTER TABLE public.sales DROP CONSTRAINT sales_product_id_fkey;
ALTER TABLE public.sales ADD CONSTRAINT sales_org_product_fkey
  FOREIGN KEY (org_id, product_id) REFERENCES public.products (org_id, id) ON DELETE CASCADE;

ALTER TABLE public.recommendations DROP CONSTRAINT recommendations_product_id_fkey;
ALTER TABLE public.recommendations ADD CONSTRAINT recommendations_org_product_fkey
  FOREIGN KEY (org_id, product_id) REFERENCES public.products (org_id, id) ON DELETE CASCADE;

ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_product_id_fkey;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_org_product_fkey
  FOREIGN KEY (org_id, product_id) REFERENCES public.products (org_id, id) ON DELETE SET NULL;

ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_supplier_id_fkey;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_org_supplier_fkey
  FOREIGN KEY (org_id, supplier_id) REFERENCES public.suppliers (org_id, id) ON DELETE SET NULL;