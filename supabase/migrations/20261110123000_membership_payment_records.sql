-- 会員決済リンクの案内・成功・失敗を管理画面で追う
CREATE TABLE IF NOT EXISTS public.membership_payment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  member_code text,
  member_name text,
  email text,
  store_name text,
  plan_id text,
  plan_name text NOT NULL,
  price_yen integer,
  amount_yen integer,
  card_kind text,
  status text NOT NULL CHECK (status IN ('guided', 'paid', 'failed')),
  reason text,
  stripe_session_id text,
  stripe_invoice_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_payment_records_session_key UNIQUE (stripe_session_id),
  CONSTRAINT membership_payment_records_invoice_key UNIQUE (stripe_invoice_id)
);

CREATE INDEX IF NOT EXISTS membership_payment_records_occurred_idx
  ON public.membership_payment_records (occurred_at DESC);

ALTER TABLE public.membership_payment_records ENABLE ROW LEVEL SECURITY;
