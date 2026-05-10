-- 会員登録: UEN046 丸子将太 / marco-showtime2050@hotmail.co.jp
-- 店舗は「上野」を優先して紐付け（無ければ store_id は NULL のまま新規のみ）
-- LINE連携: 店舗LINE公式で会員番号「UEN046」を送信 → 案内に従い「はい」で members.line_user_id が保存される

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

-- 注意: 1つのLINEユーザーIDは1会員にのみ紐付け可能（members_line_user_id_key）。
-- 以前 UEN045 など別番号で同じLINEを連携済みの場合は、先にその会員の line_user_id を NULL にしてから
-- 公式LINEで「UEN046」→「はい」の連携を行ってください。
