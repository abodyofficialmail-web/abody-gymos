-- カルテ（トレーニング履歴）: 会員ごとに統合表示しつつ、店舗・トレーナー情報を必ず保持する
CREATE TABLE IF NOT EXISTS public.client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  trainer_id uuid NOT NULL REFERENCES public.trainers (id) ON DELETE RESTRICT,
  date date NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_notes_member_id_date_idx
  ON public.client_notes (member_id, date DESC);

CREATE INDEX IF NOT EXISTS client_notes_member_store_date_idx
  ON public.client_notes (member_id, store_id, date DESC);

CREATE INDEX IF NOT EXISTS client_notes_trainer_id_date_idx
  ON public.client_notes (trainer_id, date DESC);

