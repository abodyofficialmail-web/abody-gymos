-- 管理用の「予定」テーブル（MTG/撮影/作業/掃除など）
-- block_booking=true の予定は会員予約カレンダーの空き枠から除外する

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.trainer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  trainer_id uuid NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  event_date text NOT NULL, -- YYYY-MM-DD (JST)
  start_local text NOT NULL, -- HH:MM:SS
  end_local text NOT NULL, -- HH:MM:SS
  title text NOT NULL DEFAULT '',
  notes text,
  block_booking boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_events_store_date_idx ON public.trainer_events(store_id, event_date);
CREATE INDEX IF NOT EXISTS trainer_events_trainer_date_idx ON public.trainer_events(trainer_id, event_date);

-- updated_at 自動更新
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at_trainer_events'
  ) THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at_trainer_events()
    RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_set_updated_at_trainer_events ON public.trainer_events;
CREATE TRIGGER trg_set_updated_at_trainer_events
BEFORE UPDATE ON public.trainer_events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_trainer_events();

