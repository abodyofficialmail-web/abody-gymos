-- 毎週月曜の目標ヒアリングLINEの重複送信防止
CREATE TABLE IF NOT EXISTS public.goal_hearing_monday_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  member_code text NOT NULL,
  with_photo boolean NOT NULL DEFAULT true,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, member_code)
);

CREATE INDEX IF NOT EXISTS goal_hearing_monday_dispatches_week_idx
  ON public.goal_hearing_monday_dispatches (week_start);
