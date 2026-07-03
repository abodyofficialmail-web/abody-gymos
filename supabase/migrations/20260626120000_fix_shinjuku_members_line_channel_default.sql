-- 新宿会員（SHI/SHJ）は現状、恵比寿LINE公式（default）と連携している。
-- 会員番号から shinjuku へ上書きした 20260625120000 が誤りで push が失敗していたため default に戻す。
-- 新宿専用LINEが本番トークン設定済みになったら、連携時の channelKey（Webhook）を正とする。

UPDATE public.members
SET line_channel_key = 'default', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND (member_code ILIKE 'SHI%' OR member_code ILIKE 'SHJ%')
  AND line_channel_key = 'shinjuku';
