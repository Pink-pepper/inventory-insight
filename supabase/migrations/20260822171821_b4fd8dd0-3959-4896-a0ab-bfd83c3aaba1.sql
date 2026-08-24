ALTER TABLE public.purchase_orders
  ADD COLUMN received_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN ordered_at date,
  ADD COLUMN source_row_hash text,
  ADD COLUMN import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX purchase_orders_org_hash_key
  ON public.purchase_orders (org_id, source_row_hash)
  WHERE source_row_hash IS NOT NULL;

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_org_batch_fk
  FOREIGN KEY (org_id, import_batch_id)
  REFERENCES public.import_batches (org_id, id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.purchase_orders.received_quantity IS 'Units received so far; outstanding supply = quantity - received_quantity.';
COMMENT ON COLUMN public.purchase_orders.source_row_hash IS 'Deterministic fingerprint of the ingested row; prevents duplicate inserts on re-import.';
COMMENT ON COLUMN public.purchase_orders.import_batch_id IS 'Provenance: the import batch that created this row.';