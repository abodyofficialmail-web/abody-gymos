-- オンライン会員（ON）・在宅（ZAI）も恵比寿公式LINE（default）と連携
UPDATE public.members
SET line_channel_key = 'default', updated_at = now()
WHERE line_user_id IS NOT NULL
  AND line_channel_key IS NULL
  AND (member_code ILIKE 'ON%' OR member_code ILIKE 'ZAI%');
