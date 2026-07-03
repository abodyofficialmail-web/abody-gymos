-- 福岡店を追加

INSERT INTO public.stores (name, timezone, is_active)
SELECT '福岡', 'Asia/Tokyo', true
WHERE NOT EXISTS (SELECT 1 FROM public.stores WHERE name = '福岡');

-- LINE 連携チャネルに fukuoka を追加
ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_line_channel_key_check;

ALTER TABLE public.members
  ADD CONSTRAINT members_line_channel_key_check
  CHECK (
    line_channel_key IS NULL
    OR line_channel_key IN ('default', 'ueno', 'sakuragicho', 'shinjuku', 'fukuoka')
  );
