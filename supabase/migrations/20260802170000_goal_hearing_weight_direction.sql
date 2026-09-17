-- 体重の方向性カラム追加
ALTER TABLE public.goal_hearing_responses
  ADD COLUMN IF NOT EXISTS weight_direction text;
