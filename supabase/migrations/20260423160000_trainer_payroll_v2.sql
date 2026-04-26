-- 給与計算 v2: 店舗別交通費 / 経費 / 休憩分 / 固定交通費削除

-- 固定の交通費（1日あたり）は廃止（店舗別へ移行）
ALTER TABLE public.trainers
  DROP COLUMN IF EXISTS transport_cost;

-- シフト: 休憩時間（分）。給与からは差し引かないが、日別表示などに利用する
ALTER TABLE public.trainer_shifts
  ADD COLUMN IF NOT EXISTS break_minutes integer NOT NULL DEFAULT 0;

-- 店舗別交通費（1日あたり）
CREATE TABLE IF NOT EXISTS public.trainer_transport_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid REFERENCES public.trainers(id),
  store_id uuid REFERENCES public.stores(id),
  cost integer NOT NULL DEFAULT 0
);

-- 経費
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trainer_expense_type') THEN
    CREATE TYPE public.trainer_expense_type AS ENUM ('monthly', 'daily');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.trainer_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid REFERENCES public.trainers(id),
  title text NOT NULL DEFAULT '',
  amount integer NOT NULL DEFAULT 0,
  type public.trainer_expense_type NOT NULL DEFAULT 'monthly'
);

-- 1トレーナー×1店舗は原則1行にしたい（重複を防ぐ）
CREATE UNIQUE INDEX IF NOT EXISTS trainer_transport_costs_unique_trainer_store
  ON public.trainer_transport_costs (trainer_id, store_id);

