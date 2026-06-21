-- UEN057: 森貴昭 / takaaki.rug@icloud.com（上野）
-- SHI003: 相川翔 / good_again123@yahoo.co.jp（新宿）
-- LINE連携: 各店舗LINE公式で会員番号を送信 → 案内に従い「はい」で members.line_user_id が保存される

-- UEN057
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
  'UEN057',
  '森貴昭',
  '森貴昭',
  'takaaki.rug@icloud.com',
  true,
  (SELECT id FROM public.stores WHERE name = '上野' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'UEN057');

UPDATE public.members
SET
  display_name = '森貴昭',
  name = '森貴昭',
  email = 'takaaki.rug@icloud.com',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '上野' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'UEN057';

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
WHERE m.member_code = 'UEN057'
  AND s.name = '上野'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
LIMIT 1;

-- SHI003
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
  'SHI003',
  '相川翔',
  '相川翔',
  'good_again123@yahoo.co.jp',
  true,
  (SELECT id FROM public.stores WHERE name = '新宿' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'SHI003');

UPDATE public.members
SET
  display_name = '相川翔',
  name = '相川翔',
  email = 'good_again123@yahoo.co.jp',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '新宿' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'SHI003';

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
WHERE m.member_code = 'SHI003'
  AND s.name = '新宿'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
  AND COALESCE(
    (SELECT t.id FROM public.trainers t WHERE t.store_id = s.id AND t.is_active IS TRUE LIMIT 1),
    (SELECT t.id FROM public.trainers t WHERE t.is_active IS TRUE LIMIT 1)
  ) IS NOT NULL;
