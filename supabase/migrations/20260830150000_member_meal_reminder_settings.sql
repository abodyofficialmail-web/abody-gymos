-- 食事LINE案内の配信時刻（会員ごと）と、間食枠

ALTER TABLE public.meal_personal_reminder_dispatches
  DROP CONSTRAINT IF EXISTS meal_personal_reminder_dispatches_meal_slot_check;

ALTER TABLE public.meal_personal_reminder_dispatches
  ADD CONSTRAINT meal_personal_reminder_dispatches_meal_slot_check
  CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner', 'snack'));

CREATE TABLE IF NOT EXISTS public.member_meal_reminder_settings (
  member_id uuid PRIMARY KEY REFERENCES public.members (id) ON DELETE CASCADE,
  breakfast_time time NOT NULL DEFAULT '08:00',
  lunch_time time NOT NULL DEFAULT '12:00',
  dinner_time time NOT NULL DEFAULT '19:00',
  snack_time time NOT NULL DEFAULT '15:00',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.member_meal_reminder_settings IS
  'Per-member LINE reminder times for breakfast/lunch/dinner/snack (JST).';
