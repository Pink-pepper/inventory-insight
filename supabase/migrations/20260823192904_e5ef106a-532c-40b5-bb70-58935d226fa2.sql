-- Fix composite foreign keys whose ON DELETE SET NULL also nulled org_id
-- (NOT NULL), breaking any delete of a referenced parent row. Restrict the
-- null-ing to the business column only; org_id is never touched.

ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_org_product_fkey;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_org_product_fkey
  FOREIGN KEY (org_id, product_id) REFERENCES public.products (org_id, id) ON DELETE SET NULL (product_id);

ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_org_supplier_fkey;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_org_supplier_fkey
  FOREIGN KEY (org_id, supplier_id) REFERENCES public.suppliers (org_id, id) ON DELETE SET NULL (supplier_id);

ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_org_location_fkey;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_org_location_fkey
  FOREIGN KEY (org_id, location_id) REFERENCES public.locations (org_id, id) ON DELETE SET NULL (location_id);

ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_org_batch_fk;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_org_batch_fk
  FOREIGN KEY (org_id, import_batch_id) REFERENCES public.import_batches (org_id, id) ON DELETE SET NULL (import_batch_id);

ALTER TABLE public.sales_transactions DROP CONSTRAINT sales_tx_org_customer_fkey;
ALTER TABLE public.sales_transactions ADD CONSTRAINT sales_tx_org_customer_fkey
  FOREIGN KEY (org_id, customer_id) REFERENCES public.customers (org_id, id) ON DELETE SET NULL (customer_id);

ALTER TABLE public.sales_transactions DROP CONSTRAINT sales_tx_org_channel_fkey;
ALTER TABLE public.sales_transactions ADD CONSTRAINT sales_tx_org_channel_fkey
  FOREIGN KEY (org_id, channel_id) REFERENCES public.channels (org_id, id) ON DELETE SET NULL (channel_id);

ALTER TABLE public.sales_transactions DROP CONSTRAINT sales_tx_org_location_fkey;
ALTER TABLE public.sales_transactions ADD CONSTRAINT sales_tx_org_location_fkey
  FOREIGN KEY (org_id, location_id) REFERENCES public.locations (org_id, id) ON DELETE SET NULL (location_id);

ALTER TABLE public.sales_transactions DROP CONSTRAINT sales_tx_org_batch_fkey;
ALTER TABLE public.sales_transactions ADD CONSTRAINT sales_tx_org_batch_fkey
  FOREIGN KEY (org_id, import_batch_id) REFERENCES public.import_batches (org_id, id) ON DELETE SET NULL (import_batch_id);

ALTER TABLE public.inventory DROP CONSTRAINT inventory_org_location_fkey;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_org_location_fkey
  FOREIGN KEY (org_id, location_id) REFERENCES public.locations (org_id, id) ON DELETE SET NULL (location_id);

-- Import lifecycle: owners/admins may transition batch status
-- (completed/active -> inactive -> deleted). Status is the only mutable
-- column; hard deletes stay blocked (no DELETE policy) for auditability.
GRANT UPDATE (status) ON public.import_batches TO authenticated;

CREATE POLICY "tenant batch lifecycle update" ON public.import_batches
  FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));