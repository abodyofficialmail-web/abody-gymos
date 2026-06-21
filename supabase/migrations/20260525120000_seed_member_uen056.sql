-- UEN056: 池野奨平 / ikeno.shohei@gmail.com（上野）
-- LINE連携: 上野店LINE公式で会員番号「UEN056」を送信 → 案内に従い「はい」で members.line_user_id が保存される

INSERT INTO public.members (
  id,
  member_code,
  display_name,
  name,
  email,
  is_active,
  store_id,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  'UEN056',
  '池野奨平',
  '池野奨平',
  'ikeno.shohei@gmail.com',
  true,
  (SELECT id FROM public.stores WHERE name = '上野' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'UEN056');

UPDATE public.members
SET
  display_name = '池野奨平',
  name = '池野奨平',
  email = 'ikeno.shohei@gmail.com',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '上野' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'UEN056';

INSERT INTO public.client_notes (member_id, store_id, trainer_id, date, content)
SELECT
  m.id,
  s.id,
  t.id,
  CURRENT_DATE,
  '初回カルテ（自動投入）'
FROM public.members m
JOIN public.stores s ON s.id = m.store_id
JOIN public.trainers t ON t.store_id = s.id AND (t.is_active IS TRUE)
WHERE m.member_code = 'UEN056'
  AND s.name = '上野'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
LIMIT 1;
