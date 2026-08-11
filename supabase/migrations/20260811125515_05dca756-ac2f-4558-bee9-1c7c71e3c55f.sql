ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS run_id uuid,
  ADD COLUMN IF NOT EXISTS run_started_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS recommendations_org_run_idx ON public.recommendations (org_id, run_id);