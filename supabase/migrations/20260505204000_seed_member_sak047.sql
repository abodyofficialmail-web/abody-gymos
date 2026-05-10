-- SAK047: 赤崎真希 / mkmk_wkwk@icloud.com
-- 店舗は「桜木町」を優先して紐付け（無ければ store_id は NULL のまま新規のみ）
-- LINE連携: 店舗LINE公式で会員番号「SAK047」を送信 → 案内に従い「はい」で members.line_user_id が保存される

-- 会員を登録（冪等）
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
  'SAK047',
  '赤崎真希',
  '赤崎真希',
  'mkmk_wkwk@icloud.com',
  true,
  (SELECT id FROM public.stores WHERE name = '桜木町' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'SAK047');

UPDATE public.members
SET
  display_name = '赤崎真希',
  name = '赤崎真希',
  email = 'mkmk_wkwk@icloud.com',
  is_active = true,
  store_id = COALESCE(
    (SELECT id FROM public.stores WHERE name = '桜木町' LIMIT 1),
    store_id
  ),
  updated_at = now()
WHERE member_code = 'SAK047';

-- カルテを1件投入（可能なときだけ）
-- trainer_id は「桜木町」のアクティブトレーナーを1名自動選択（いなければスキップ）
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
WHERE m.member_code = 'SAK047'
  AND s.name = '桜木町'
  AND NOT EXISTS (
    SELECT 1
    FROM public.client_notes n
    WHERE n.member_id = m.id
  )
LIMIT 1;

