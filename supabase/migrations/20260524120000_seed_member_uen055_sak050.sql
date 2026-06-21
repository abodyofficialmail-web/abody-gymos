-- UEN055: 小川真美 / pash_404@yahoo.co.jp（上野）
-- SAK050: 北山潤美 / uruminn@I.softbank.jp（桜木町）
-- LINE連携: 各店舗LINE公式で会員番号を送信 → 案内に従い「はい」で members.line_user_id が保存される

-- UEN055
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
  'UEN055',
  '小川真美',
  '小川真美',
  'pash_404@yahoo.co.jp',
  true,
  (SELECT id FROM public.stores WHERE name = '上野' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'UEN055');

UPDATE public.members
SET
  display_name = '小川真美',
  name = '小川真美',
  email = 'pash_404@yahoo.co.jp',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '上野' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'UEN055';

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
WHERE m.member_code = 'UEN055'
  AND s.name = '上野'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
LIMIT 1;

-- SAK050
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
  'SAK050',
  '北山潤美',
  '北山潤美',
  'uruminn@I.softbank.jp',
  true,
  (SELECT id FROM public.stores WHERE name = '桜木町' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'SAK050');

UPDATE public.members
SET
  display_name = '北山潤美',
  name = '北山潤美',
  email = 'uruminn@I.softbank.jp',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '桜木町' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'SAK050';

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
WHERE m.member_code = 'SAK050'
  AND s.name = '桜木町'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
  AND COALESCE(
    (SELECT t.id FROM public.trainers t WHERE t.store_id = s.id AND t.is_active IS TRUE LIMIT 1),
    (SELECT t.id FROM public.trainers t WHERE t.is_active IS TRUE LIMIT 1)
  ) IS NOT NULL;
