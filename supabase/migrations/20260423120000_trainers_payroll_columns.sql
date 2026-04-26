-- 給与計算用（時給・交通費・定期代）
ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS hourly_rate integer NOT NULL DEFAULT 0;

ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS transport_cost integer NOT NULL DEFAULT 0;

ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS monthly_pass_cost integer NOT NULL DEFAULT 0;
