-- 会員の自主／パーソナル等のトレーニング記録（1日1件）

CREATE TABLE IF NOT EXISTS public.member_training_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  log_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('gym', 'self', 'cardio', 'rest')),
  parts text[] NOT NULL DEFAULT '{}',
  duration_min integer CHECK (duration_min IS NULL OR (duration_min >= 0 AND duration_min <= 600)),
  condition text CHECK (condition IS NULL OR condition IN ('good', 'normal', 'hard')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, log_date)
);

CREATE INDEX IF NOT EXISTS member_training_logs_member_date_idx
  ON public.member_training_logs (member_id, log_date DESC);

COMMENT ON TABLE public.member_training_logs IS
  'Daily member training logs for meal-personal record tab.';
