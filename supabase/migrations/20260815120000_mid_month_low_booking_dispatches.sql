-- 毎月15日の予約少ない会員フォローLINEの重複送信防止
CREATE TABLE IF NOT EXISTS public.mid_month_low_booking_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month text NOT NULL,
  member_code text NOT NULL,
  with_photo boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year_month, member_code)
);

CREATE INDEX IF NOT EXISTS mid_month_low_booking_dispatches_month_idx
  ON public.mid_month_low_booking_dispatches (year_month);
