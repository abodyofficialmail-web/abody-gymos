ALTER TABLE public.membership_payment_records
  ADD COLUMN IF NOT EXISTS stopped_at timestamptz;
