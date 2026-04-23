-- LINE ユーザーIDと会員の紐付け（店舗は紐付けない）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS line_user_id text;

-- 同一 LINE アカウントは1会員のみ（NULL は複数可）
CREATE UNIQUE INDEX IF NOT EXISTS members_line_user_id_key
  ON public.members (line_user_id)
  WHERE line_user_id IS NOT NULL;

-- オプション: Messaging API Webhook の destination（ボットユーザーID）ごとにデフォルト店舗
CREATE TABLE IF NOT EXISTS public.line_channel_default_stores (
  line_destination_id text PRIMARY KEY,
  default_store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS line_channel_default_stores_default_store_id_idx
  ON public.line_channel_default_stores (default_store_id);
