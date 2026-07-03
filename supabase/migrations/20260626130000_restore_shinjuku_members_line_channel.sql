-- 新宿会員は新宿公式LINEと連携（Webhook で shinjuku）。誤って default に戻していた分を修正。
UPDATE public.members
SET line_channel_key = 'shinjuku', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND (member_code ILIKE 'SHI%' OR member_code ILIKE 'SHJ%')
  AND line_channel_key IS DISTINCT FROM 'shinjuku';
