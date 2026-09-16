-- 会員の日次体重記録（マイページ自己入力）と、朝の測定案内LINEの重複送信防止

CREATE TABLE IF NOT EXISTS public.member_weight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  log_date date NOT NULL,
  weight_kg numeric(5, 1) NOT NULL CHECK (weight_kg >= 15 AND weight_kg <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, log_date)
);

CREATE INDEX IF NOT EXISTS member_weight_logs_member_date_idx
  ON public.member_weight_logs (member_id, log_date DESC);

COMMENT ON TABLE public.member_weight_logs IS
  'Daily body-weight logs entered by the member from mypage / LINE reminder.';

CREATE TABLE IF NOT EXISTS public.morning_weight_reminder_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  log_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, log_date)
);

CREATE INDEX IF NOT EXISTS morning_weight_reminder_dispatches_date_idx
  ON public.morning_weight_reminder_dispatches (log_date DESC);

COMMENT ON TABLE public.morning_weight_reminder_dispatches IS
  'Dedupes the daily morning weight-measurement LINE reminder (one send per member per JST date).';
