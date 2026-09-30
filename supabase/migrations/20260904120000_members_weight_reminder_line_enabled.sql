-- 会員向け 毎朝の体重・体脂肪 LINE 案内の ON/OFF
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS weight_reminder_line_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.members.weight_reminder_line_enabled IS
  '会員向け毎朝の体重・体脂肪LINE案内のON/OFF。マイページから切替。予約通知等は対象外';

-- 列が無かった間は morning_weight_reminder_dispatches の 9999-12-31 行が OFF
UPDATE public.members AS m
SET weight_reminder_line_enabled = false
WHERE EXISTS (
  SELECT 1
  FROM public.morning_weight_reminder_dispatches AS d
  WHERE d.member_id = m.id
    AND d.log_date = DATE '9999-12-31'
);
