-- トレーナー専用LINE連携（会員membersとは別）
ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS line_user_id text,
  ADD COLUMN IF NOT EXISTS line_channel_key text;

COMMENT ON COLUMN public.trainers.line_user_id IS
  '恵比寿公式LINEなど、運営報告のpush先。会員のline_user_idとは別管理';

CREATE UNIQUE INDEX IF NOT EXISTS trainers_line_user_id_uidx
  ON public.trainers (line_user_id)
  WHERE line_user_id IS NOT NULL;
