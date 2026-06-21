-- SHI001: 寺田真二郎 / shinjir000@yahoo.co.jp（新宿）
-- SHI002: 渡邉友哉 / wtnbtmy1119@gmail.com（新宿）
-- LINE連携: 新宿店LINE公式で会員番号を送信 → 案内に従い「はい」で members.line_user_id が保存される

-- SHI001
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
  'SHI001',
  '寺田真二郎',
  '寺田真二郎',
  'shinjir000@yahoo.co.jp',
  true,
  (SELECT id FROM public.stores WHERE name = '新宿' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'SHI001');

UPDATE public.members
SET
  display_name = '寺田真二郎',
  name = '寺田真二郎',
  email = 'shinjir000@yahoo.co.jp',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '新宿' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'SHI001';

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
WHERE m.member_code = 'SHI001'
  AND s.name = '新宿'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
  AND COALESCE(
    (SELECT t.id FROM public.trainers t WHERE t.store_id = s.id AND t.is_active IS TRUE LIMIT 1),
    (SELECT t.id FROM public.trainers t WHERE t.is_active IS TRUE LIMIT 1)
  ) IS NOT NULL;

-- SHI002
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
  'SHI002',
  '渡邉友哉',
  '渡邉友哉',
  'wtnbtmy1119@gmail.com',
  true,
  (SELECT id FROM public.stores WHERE name = '新宿' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'SHI002');

UPDATE public.members
SET
  display_name = '渡邉友哉',
  name = '渡邉友哉',
  email = 'wtnbtmy1119@gmail.com',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '新宿' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'SHI002';

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
WHERE m.member_code = 'SHI002'
  AND s.name = '新宿'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
  AND COALESCE(
    (SELECT t.id FROM public.trainers t WHERE t.store_id = s.id AND t.is_active IS TRUE LIMIT 1),
    (SELECT t.id FROM public.trainers t WHERE t.is_active IS TRUE LIMIT 1)
  ) IS NOT NULL;
