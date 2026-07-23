-- 予約リマインドLINE（60分前）の重複送信防止
CREATE TABLE IF NOT EXISTS public.reservation_line_reminder_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('60m_reminder', '60m_pre_session_survey')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, kind)
);

CREATE INDEX IF NOT EXISTS reservation_line_reminder_dispatches_reservation_idx
  ON public.reservation_line_reminder_dispatches (reservation_id);

CREATE INDEX IF NOT EXISTS reservation_line_reminder_dispatches_sent_at_idx
  ON public.reservation_line_reminder_dispatches (sent_at);
