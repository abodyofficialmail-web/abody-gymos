-- 食事パーソナル（写真PFC推定・生活記録・LINE案内）

CREATE TABLE IF NOT EXISTS public.member_meal_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  log_date date NOT NULL,
  meal_slot text NOT NULL CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  photo_path text,
  note text,
  items jsonb,
  kcal numeric(6, 0) NOT NULL CHECK (kcal >= 0 AND kcal <= 5000),
  protein_g numeric(5, 1) NOT NULL CHECK (protein_g >= 0 AND protein_g <= 400),
  fat_g numeric(5, 1) NOT NULL CHECK (fat_g >= 0 AND fat_g <= 400),
  carb_g numeric(5, 1) NOT NULL CHECK (carb_g >= 0 AND carb_g <= 800),
  alcohol_g numeric(5, 1),
  confidence numeric(3, 2),
  source text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_meal_logs_member_date_idx
  ON public.member_meal_logs (member_id, log_date DESC, created_at DESC);

COMMENT ON TABLE public.member_meal_logs IS
  'Meal logs with optional photo and estimated PFC/kcal.';

CREATE TABLE IF NOT EXISTS public.member_lifestyle_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  log_date date NOT NULL,
  water_ml integer CHECK (water_ml IS NULL OR (water_ml >= 0 AND water_ml <= 10000)),
  alcohol_drinks numeric(4, 1) CHECK (alcohol_drinks IS NULL OR (alcohol_drinks >= 0 AND alcohol_drinks <= 30)),
  bowel_count integer CHECK (bowel_count IS NULL OR (bowel_count >= 0 AND bowel_count <= 10)),
  bowel_quality text CHECK (bowel_quality IS NULL OR bowel_quality IN ('normal', 'hard', 'loose', 'none')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, log_date)
);

CREATE INDEX IF NOT EXISTS member_lifestyle_logs_member_date_idx
  ON public.member_lifestyle_logs (member_id, log_date DESC);

COMMENT ON TABLE public.member_lifestyle_logs IS
  'Daily water / alcohol / bowel logs for meal-personal analysis.';

CREATE TABLE IF NOT EXISTS public.meal_personal_reminder_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  log_date date NOT NULL,
  meal_slot text NOT NULL CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, log_date, meal_slot)
);

CREATE INDEX IF NOT EXISTS meal_personal_reminder_dispatches_date_idx
  ON public.meal_personal_reminder_dispatches (log_date DESC, meal_slot);

COMMENT ON TABLE public.meal_personal_reminder_dispatches IS
  'Dedupes breakfast/lunch/dinner meal-log LINE reminders.';
