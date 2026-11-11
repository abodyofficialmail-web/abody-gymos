ALTER TABLE public.membership_payment_records
  ADD COLUMN IF NOT EXISTS period_start timestamptz,
  ADD COLUMN IF NOT EXISTS period_end timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE INDEX IF NOT EXISTS membership_payment_records_subscription_idx
  ON public.membership_payment_records (stripe_subscription_id);
