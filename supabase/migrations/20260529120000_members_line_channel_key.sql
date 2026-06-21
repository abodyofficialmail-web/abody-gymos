-- 連携した LINE 公式アカウント（push トークン選択用）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS line_channel_key text;

ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_line_channel_key_check;

ALTER TABLE public.members
  ADD CONSTRAINT members_line_channel_key_check
  CHECK (
    line_channel_key IS NULL
    OR line_channel_key IN ('default', 'ueno', 'sakuragicho', 'shinjuku')
  );

COMMENT ON COLUMN public.members.line_channel_key IS
  'LINE Webhook 連携時のチャネル。push は会員番号ではなくこちらを優先する';

-- UEN018: 恵比寿公式LINEで連携（運用確認済み）
UPDATE public.members
SET line_channel_key = 'default', updated_at = now()
WHERE member_code = 'UEN018'
  AND line_user_id IS NOT NULL
  AND (line_channel_key IS NULL OR line_channel_key <> 'default');
