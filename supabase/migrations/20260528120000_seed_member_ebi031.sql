-- EBI031: 鈴木大輝 / oblsdi@icloud.com（恵比寿）
-- LINE連携: 恵比寿店LINE公式で会員番号「EBI031」を送信 → 案内に従い「はい」で members.line_user_id が保存される

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
  'EBI031',
  '鈴木大輝',
  '鈴木大輝',
  'oblsdi@icloud.com',
  true,
  (SELECT id FROM public.stores WHERE name = '恵比寿' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'EBI031');

UPDATE public.members
SET
  display_name = '鈴木大輝',
  name = '鈴木大輝',
  email = 'oblsdi@icloud.com',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '恵比寿' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'EBI031';

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
WHERE m.member_code = 'EBI031'
  AND s.name = '恵比寿'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
  AND COALESCE(
    (SELECT t.id FROM public.trainers t WHERE t.store_id = s.id AND t.is_active IS TRUE LIMIT 1),
    (SELECT t.id FROM public.trainers t WHERE t.is_active IS TRUE LIMIT 1)
  ) IS NOT NULL;
