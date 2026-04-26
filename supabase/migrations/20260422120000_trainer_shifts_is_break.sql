-- 休憩ブロック用（予約枠には含めない）
ALTER TABLE public.trainer_shifts
  ADD COLUMN IF NOT EXISTS is_break boolean NOT NULL DEFAULT false;
