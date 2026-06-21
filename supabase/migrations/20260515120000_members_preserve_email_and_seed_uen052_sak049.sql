-- 取込・部分更新で email が NULL に上書きされないようにする（LINE連携と同様）
CREATE OR REPLACE FUNCTION public.preserve_members_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS NULL AND OLD.email IS NOT NULL THEN
    NEW.email := OLD.email;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS members_preserve_email_trg ON public.members;
CREATE TRIGGER members_preserve_email_trg
BEFORE UPDATE ON public.members
FOR EACH ROW
EXECUTE FUNCTION public.preserve_members_email();

-- UEN052: 崔 智穎 / tomoeisai@gmail.com（上野）
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
  'UEN052',
  '崔　智穎',
  '崔　智穎',
  'tomoeisai@gmail.com',
  true,
  (SELECT id FROM public.stores WHERE name = '上野' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'UEN052');

UPDATE public.members
SET
  display_name = '崔　智穎',
  name = '崔　智穎',
  email = 'tomoeisai@gmail.com',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '上野' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'UEN052';

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
WHERE m.member_code = 'UEN052'
  AND s.name = '上野'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
LIMIT 1;

-- SAK049: 藤咲彩香 / ayaka19951016@yahoo.co.jp（桜木町）
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
  'SAK049',
  '藤咲彩香',
  '藤咲彩香',
  'ayaka19951016@yahoo.co.jp',
  true,
  (SELECT id FROM public.stores WHERE name = '桜木町' LIMIT 1),
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.member_code = 'SAK049');

UPDATE public.members
SET
  display_name = '藤咲彩香',
  name = '藤咲彩香',
  email = 'ayaka19951016@yahoo.co.jp',
  is_active = true,
  store_id = COALESCE((SELECT id FROM public.stores WHERE name = '桜木町' LIMIT 1), store_id),
  updated_at = now()
WHERE member_code = 'SAK049';

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
WHERE m.member_code = 'SAK049'
  AND s.name = '桜木町'
  AND NOT EXISTS (SELECT 1 FROM public.client_notes n WHERE n.member_id = m.id)
  AND COALESCE(
    (SELECT t.id FROM public.trainers t WHERE t.store_id = s.id AND t.is_active IS TRUE LIMIT 1),
    (SELECT t.id FROM public.trainers t WHERE t.is_active IS TRUE LIMIT 1)
  ) IS NOT NULL;
