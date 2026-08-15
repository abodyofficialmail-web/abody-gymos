-- 店舗責任者（所属店舗とは別。例: ひろむ・せいや → 上野）
CREATE TABLE IF NOT EXISTS public.trainer_managed_stores (
  trainer_id uuid NOT NULL REFERENCES public.trainers (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trainer_id, store_id)
);

COMMENT ON TABLE public.trainer_managed_stores IS
  '店舗責任者。日報・予約フォロー・発注共有の対象店舗';

INSERT INTO public.trainer_managed_stores (trainer_id, store_id)
SELECT t.id, s.id
FROM public.trainers t
JOIN public.stores s ON (
  (t.display_name IN ('ひろむ', 'せいや') AND s.name = '上野')
  OR (t.display_name = 'りょう' AND s.name = '桜木町')
  OR (t.display_name = 'ゆうと' AND s.name IN ('新宿', '恵比寿'))
  OR (t.display_name = 'ともき' AND s.name = '福岡')
)
ON CONFLICT DO NOTHING;

-- トレーナーLINEからの発注・報告・会員意見
CREATE TABLE IF NOT EXISTS public.trainer_ops_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES public.trainers (id) ON DELETE CASCADE,
  store_id uuid NULL REFERENCES public.stores (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('order', 'report', 'feedback', 'other')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS trainer_ops_messages_open_idx
  ON public.trainer_ops_messages (status, created_at DESC);

CREATE INDEX IF NOT EXISTS trainer_ops_messages_store_idx
  ON public.trainer_ops_messages (store_id, created_at DESC);
