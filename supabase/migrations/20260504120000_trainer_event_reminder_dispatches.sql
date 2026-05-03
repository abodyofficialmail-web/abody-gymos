-- ダイキ（指定トレーナー）予定の LINE リマインド重複送信防止
CREATE TABLE IF NOT EXISTS public.trainer_event_reminder_dispatches (
  event_id uuid NOT NULL REFERENCES public.trainer_events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('60min', '10min')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, kind)
);

CREATE INDEX IF NOT EXISTS trainer_event_reminder_dispatches_sent_at_idx
  ON public.trainer_event_reminder_dispatches (sent_at);
