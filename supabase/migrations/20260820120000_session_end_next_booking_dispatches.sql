-- セッション終了後の次回予約LINE の重複送信防止
CREATE TABLE IF NOT EXISTS public.session_end_next_booking_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations (id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id)
);

CREATE INDEX IF NOT EXISTS session_end_next_booking_dispatches_sent_at_idx
  ON public.session_end_next_booking_dispatches (sent_at);
