-- 日次記録に体脂肪率を追加（任意入力）

ALTER TABLE public.member_weight_logs
  ADD COLUMN IF NOT EXISTS body_fat_pct numeric(4, 1)
  CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 3 AND body_fat_pct <= 60));

COMMENT ON COLUMN public.member_weight_logs.body_fat_pct IS
  'Optional daily body-fat percentage entered by the member.';
