-- 複数休憩（シフト内の休憩時間帯）
CREATE TABLE IF NOT EXISTS public.trainer_shift_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.trainer_shifts(id) ON DELETE CASCADE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_shift_breaks_shift_id_idx
  ON public.trainer_shift_breaks (shift_id);

