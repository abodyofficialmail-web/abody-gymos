-- 会員の当日変更を「1予約につき1回まで」に制限するためのカラム
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS last_rescheduled_at timestamptz;

