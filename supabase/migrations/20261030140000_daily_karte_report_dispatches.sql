-- 毎日22:30のカルテ日報（ゆうと宛）の重複送信防止
CREATE TABLE IF NOT EXISTS public.daily_karte_report_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL UNIQUE,
  sent_at timestamptz NOT NULL DEFAULT now()
);
