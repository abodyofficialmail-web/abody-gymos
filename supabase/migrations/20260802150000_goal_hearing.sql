-- 目標ヒアリング（招待・回答・目標写真パス）

CREATE TABLE IF NOT EXISTS public.goal_hearing_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores (id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  line_sent_at timestamptz,
  responded_at timestamptz,
  client_note_id uuid REFERENCES public.client_notes (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goal_hearing_invites_member_created_idx
  ON public.goal_hearing_invites (member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.goal_hearing_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid UNIQUE REFERENCES public.goal_hearing_invites (id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores (id) ON DELETE SET NULL,
  client_note_id uuid REFERENCES public.client_notes (id) ON DELETE SET NULL,
  primary_goal text NOT NULL,
  secondary_goal text,
  tertiary_goal text,
  focus_areas text[] NOT NULL DEFAULT '{}',
  weight_direction text,
  current_weight_kg numeric,
  target_weight_kg numeric,
  current_body_fat_pct numeric,
  target_body_fat_pct numeric,
  current_waist_cm numeric,
  target_waist_cm numeric,
  numeric_goals_undecided boolean NOT NULL DEFAULT false,
  deadline_type text NOT NULL,
  deadline_date date,
  goal_reason text,
  goal_reason_other text,
  sex text NOT NULL CHECK (sex IN ('female', 'male')),
  birth_date date,
  age_years smallint,
  height_cm numeric NOT NULL,
  weight_unknown boolean NOT NULL DEFAULT false,
  activity_level text NOT NULL,
  ideal_frequency text NOT NULL,
  preferred_slots text[] NOT NULL DEFAULT '{}',
  sleep_hours text NOT NULL,
  challenges text[] NOT NULL DEFAULT '{}',
  meal_change text,
  pain_areas text[] NOT NULL DEFAULT '{}',
  training_styles text[] NOT NULL DEFAULT '{}',
  medical_restrictions text,
  free_comment text,
  goal_photo_paths text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goal_hearing_responses_photos_min CHECK (cardinality(goal_photo_paths) >= 1)
);

CREATE INDEX IF NOT EXISTS goal_hearing_responses_member_created_idx
  ON public.goal_hearing_responses (member_id, created_at DESC);
