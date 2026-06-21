-- EBI030: 中井由奈 / yuna0825.lucy0122@gmail.com（恵比寿）
-- LINE連携: 恵比寿店LINE公式で会員番号「EBI030」を送信 → 案内に従い「はい」で members.line_user_id が保存される

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
  'EBI030',
  '中井由奈',
  '中井由奈',
  'yuna0825.lucy0122@gmail.com',
  true,
  (SELECT id FROM public.stores WHERE name = '恵比寿' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'EBI030');

UPDATE public.members
SET
  display_name = '中井由奈',
  name = '中井由奈',
  email = 'yuna0825.lucy0122@gmail.com',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '恵比寿' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'EBI030';

INSERT INTO public.client_notes (member_id, store_id, trainer_id, date, content)
SELECT
  m.id,
  s.id,
  COALESCE(
    (SELECT t.id FROM public.trainers t WHERE t.store_id = s.id AND t.is_active IS TRUE LIMIT 1),
    (SELECT t.id FROM public.trainers t WHERE t.is_active IS TRUE LIMIT 1)
  ),
  CURRENT_DATE,
  '初回カルテ（自動投入）'
FROM public.members m
JOIN public.stores s ON s.id = m.store_id
WHERE m.member_code = 'EBI030'
  AND s.name = '恵比寿'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
  AND COALESCE(
    (SELECT t.id FROM public.trainers t WHERE t.store_id = s.id AND t.is_active IS TRUE LIMIT 1),
    (SELECT t.id FROM public.trainers t WHERE t.is_active IS TRUE LIMIT 1)
  ) IS NOT NULL;
