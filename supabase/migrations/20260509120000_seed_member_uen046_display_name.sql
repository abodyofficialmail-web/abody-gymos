-- members.display_name が NOT NULL の環境向け（旧シードで列欠けの場合の追補）
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
