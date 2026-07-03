-- セッション前ヒアリング（60分前リマインド付き）

CREATE TABLE IF NOT EXISTS public.pre_session_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.reservations (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  trainer_id uuid REFERENCES public.trainers (id) ON DELETE SET NULL,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  session_start_at timestamptz NOT NULL,
  condition_score smallint NOT NULL CHECK (condition_score >= 1 AND condition_score <= 5),
  meal_status text NOT NULL CHECK (meal_status IN ('eaten', 'not_eaten', 'light_only')),
  intensity_preference text NOT NULL CHECK (intensity_preference IN ('light', 'moderate', 'hard')),
  request_focus text,
  concern text,
  free_comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pre_session_survey_responses_member_created_idx
  ON public.pre_session_survey_responses (member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pre_session_survey_responses_trainer_created_idx
  ON public.pre_session_survey_responses (trainer_id, created_at DESC);
