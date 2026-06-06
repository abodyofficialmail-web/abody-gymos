-- セッション後アンケート（LIFF）招待・回答・ヒアリング

CREATE TABLE IF NOT EXISTS public.session_survey_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  trainer_id uuid NOT NULL REFERENCES public.trainers (id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  session_date date NOT NULL,
  client_note_id uuid REFERENCES public.client_notes (id) ON DELETE SET NULL,
  line_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, session_date)
);

CREATE INDEX IF NOT EXISTS session_survey_invites_trainer_date_idx
  ON public.session_survey_invites (trainer_id, session_date DESC);

CREATE TABLE IF NOT EXISTS public.session_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL UNIQUE REFERENCES public.session_survey_invites (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  trainer_id uuid NOT NULL REFERENCES public.trainers (id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  session_date date NOT NULL,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  highlights text[] NOT NULL DEFAULT '{}',
  intensity_feedback text NOT NULL CHECK (intensity_feedback IN ('too_hard', 'just_right', 'more_push')),
  comment_general text,
  comment_improve text,
  comment_questions text,
  needs_followup boolean NOT NULL DEFAULT false,
  followup_status text NOT NULL DEFAULT 'none' CHECK (followup_status IN ('none', 'pending', 'done')),
  followup_note text,
  followup_handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_survey_responses_trainer_created_idx
  ON public.session_survey_responses (trainer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS session_survey_responses_followup_idx
  ON public.session_survey_responses (followup_status, created_at DESC)
  WHERE needs_followup = true;
