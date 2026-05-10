-- 管理画面「新規体験予約」: 未入会者（guest）・枠を潰さないメモ予約に対応
ALTER TABLE public.reservations
  ALTER COLUMN member_id DROP NOT NULL;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS blocks_capacity boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.reservations.guest_name IS '非会員・体験予約の表示名（member_id が NULL のとき）';
COMMENT ON COLUMN public.reservations.blocks_capacity IS 'false のとき公開予約の空き枠計算から除外（枠を潰さない）';
