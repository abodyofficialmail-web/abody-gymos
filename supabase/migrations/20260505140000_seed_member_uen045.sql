-- 会員登録: UEN045 古谷優希 / yuki23.kotafuru@gmail.com
-- 店舗は会員番号プレフィックス UEN より「上野」を優先して紐付け（無ければ store_id は NULL のまま新規のみ）

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
