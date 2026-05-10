-- UEN045 / UEN046 の氏名・メールを確定値に統一。
-- 既に旧内容でシード適用済みのDBでは、前方ファイルを書き換えても再実行されないため本マイグレーションで追い付ける。

-- UEN045: 古谷優希 / yuki23.kotafuru@gmail.com
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
  'UEN045',
  '古谷優希',
  '古谷優希',
  'yuki23.kotafuru@gmail.com',
  true,
  (SELECT id FROM public.stores WHERE name = '上野' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'UEN045');

UPDATE public.members
SET
  display_name = '古谷優希',
  name = '古谷優希',
  email = 'yuki23.kotafuru@gmail.com',
  is_active = true,
  store_id = COALESCE(
    (SELECT id FROM public.stores WHERE name = '上野' LIMIT 1),
    store_id
  ),
  updated_at = now()
WHERE member_code = 'UEN045';

-- UEN046: 丸子将太 / marco-showtime2050@hotmail.co.jp
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
  'UEN046',
  '丸子将太',
  '丸子将太',
  'marco-showtime2050@hotmail.co.jp',
  true,
  (SELECT id FROM public.stores WHERE name = '上野' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'UEN046');

UPDATE public.members
SET
  display_name = '丸子将太',
  name = '丸子将太',
  email = 'marco-showtime2050@hotmail.co.jp',
  is_active = true,
  store_id = COALESCE(
    (SELECT id FROM public.stores WHERE name = '上野' LIMIT 1),
    store_id
  ),
  updated_at = now()
WHERE member_code = 'UEN046';
