ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_org_batch_fk;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_org_batch_fk
  FOREIGN KEY (org_id, import_batch_id)
  REFERENCES public.import_batches (org_id, id);