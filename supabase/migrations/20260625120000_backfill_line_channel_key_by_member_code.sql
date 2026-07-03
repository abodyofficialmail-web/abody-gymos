-- line_user_id ありの新宿会員は shinjuku チャネルへ（誤って default 等になっている場合も修正）
UPDATE public.members
SET line_channel_key = 'shinjuku', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND (member_code ILIKE 'SHI%' OR member_code ILIKE 'SHJ%')
  AND (line_channel_key IS NULL OR line_channel_key <> 'shinjuku');

UPDATE public.members
SET line_channel_key = 'sakuragicho', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND line_channel_key IS NULL
  AND member_code ILIKE 'SAK%';

UPDATE public.members
SET line_channel_key = 'ueno', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND line_channel_key IS NULL
  AND member_code ILIKE 'UEN%';

UPDATE public.members
SET line_channel_key = 'fukuoka', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND line_channel_key IS NULL
  AND member_code ILIKE 'FUK%';

UPDATE public.members
SET line_channel_key = 'default', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND line_channel_key IS NULL
  AND member_code ILIKE 'EBI%';
