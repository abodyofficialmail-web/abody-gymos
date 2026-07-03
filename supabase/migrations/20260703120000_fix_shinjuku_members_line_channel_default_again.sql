-- 新宿会員（SHI/SHJ）は新宿公式LINE（shinjuku）と連携
UPDATE public.members
SET line_channel_key = 'shinjuku', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND (member_code ILIKE 'SHI%' OR member_code ILIKE 'SHJ%')
  AND (line_channel_key IS NULL OR line_channel_key <> 'shinjuku');
