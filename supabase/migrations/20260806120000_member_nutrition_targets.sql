-- 会員ごとの栄養目標（消費カロリー・摂取カロリー・PFC）
-- 目標ヒアリング回答で自動算出、トレーナーがカルテから編集可。マイページと同期。

CREATE TABLE IF NOT EXISTS public.member_nutrition_targets (
  member_id uuid PRIMARY KEY REFERENCES public.members (id) ON DELETE CASCADE,
  daily_expenditure_kcal integer NOT NULL CHECK (daily_expenditure_kcal >= 0 AND daily_expenditure_kcal <= 20000),
  intake_kcal integer NOT NULL CHECK (intake_kcal >= 0 AND intake_kcal <= 20000),
  intake_kcal_min integer CHECK (intake_kcal_min IS NULL OR (intake_kcal_min >= 0 AND intake_kcal_min <= 20000)),
  intake_kcal_max integer CHECK (intake_kcal_max IS NULL OR (intake_kcal_max >= 0 AND intake_kcal_max <= 20000)),
  protein_g integer NOT NULL CHECK (protein_g >= 0 AND protein_g <= 1000),
  fat_g integer NOT NULL CHECK (fat_g >= 0 AND fat_g <= 1000),
  carb_g integer NOT NULL CHECK (carb_g >= 0 AND carb_g <= 2000),
  bmr_kcal integer CHECK (bmr_kcal IS NULL OR (bmr_kcal >= 0 AND bmr_kcal <= 20000)),
  note text,
  source text NOT NULL DEFAULT 'goal_hearing'
    CHECK (source IN ('goal_hearing', 'manual')),
  goal_hearing_response_id uuid REFERENCES public.goal_hearing_responses (id) ON DELETE SET NULL,
  updated_by_trainer_id uuid REFERENCES public.trainers (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_nutrition_targets_updated_at_idx
  ON public.member_nutrition_targets (updated_at DESC);

COMMENT ON TABLE public.member_nutrition_targets IS
  'Per-member nutrition targets (TDEE / intake / PFC). Synced to karte and mypage; trainers can edit.';
