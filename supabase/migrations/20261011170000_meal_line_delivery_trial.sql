-- LINE配信プランのお試し期間。ボタン表示は1週間だが、実際の配信は3日間。

ALTER TABLE public.member_meal_reminder_settings
  ADD COLUMN IF NOT EXISTS line_delivery_trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS line_delivery_trial_ends_at timestamptz;

COMMENT ON COLUMN public.member_meal_reminder_settings.line_delivery_trial_started_at IS
  'LINE配信お試しを押した時刻。1会員1回。';
COMMENT ON COLUMN public.member_meal_reminder_settings.line_delivery_trial_ends_at IS
  'この時刻まで朝昼夜・間食のLINE配信を送る。開始から3日。';
