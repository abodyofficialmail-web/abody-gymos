-- しょうどう退職 → 非アクティブ化、こうへいを恵比寿店に追加

UPDATE public.trainers
SET is_active = false,
    updated_at = now()
WHERE display_name = 'しょうどう'
  AND is_active IS TRUE;

INSERT INTO public.trainers (
  display_name,
  store_id,
  is_active,
  user_id,
  hourly_rate_yen,
  hourly_rate,
  monthly_pass_cost
)
SELECT
  'こうへい',
  s.id,
  true,
  null,
  null,
  0,
  0
FROM public.stores s
WHERE s.name = '恵比寿'
  AND NOT EXISTS (
    SELECT 1 FROM public.trainers t WHERE t.display_name = 'こうへい'
  );
