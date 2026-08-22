CREATE TYPE public.po_approval_status AS ENUM ('needs_review', 'approved', 'rejected');

ALTER TYPE public.po_status ADD VALUE IF NOT EXISTS 'closed';

ALTER TABLE public.purchase_orders
  ADD COLUMN po_number text,
  ADD COLUMN approval_status public.po_approval_status NOT NULL DEFAULT 'needs_review',
  ADD COLUMN received_at date,
  ADD COLUMN location_id uuid,
  ADD COLUMN currency_code text,
  ADD COLUMN buyer text;

-- Documented migration assumption: POs already placed or received in the source
-- system are treated as approved; only genuinely new/unmapped imports need review.
UPDATE public.purchase_orders SET approval_status = 'approved' WHERE status IN ('placed', 'received');

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_org_location_fkey
  FOREIGN KEY (org_id, location_id) REFERENCES public.locations (org_id, id) ON DELETE SET NULL;