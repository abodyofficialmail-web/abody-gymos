-- 店舗Instagram広告・公式LINE追加の日次/週次レポート用

CREATE TABLE IF NOT EXISTS public.store_marketing_accounts (
  store_id uuid PRIMARY KEY REFERENCES public.stores (id) ON DELETE CASCADE,
  instagram_username text,
  instagram_user_id text,
  meta_ad_account_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.line_follow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_channel_key text NOT NULL,
  store_id uuid REFERENCES public.stores (id) ON DELETE SET NULL,
  line_user_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('follow', 'unfollow')),
  followed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_channel_key, line_user_id, event_type, followed_at)
);

CREATE INDEX IF NOT EXISTS line_follow_events_store_time_idx
  ON public.line_follow_events (store_id, followed_at);

CREATE INDEX IF NOT EXISTS line_follow_events_channel_time_idx
  ON public.line_follow_events (line_channel_key, followed_at);

CREATE TABLE IF NOT EXISTS public.instagram_follower_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  followers_count integer NOT NULL,
  source text NOT NULL DEFAULT 'meta_api' CHECK (source IN ('meta_api', 'manual')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS public.line_follower_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  line_channel_key text NOT NULL,
  snapshot_date date NOT NULL,
  followers_count integer NOT NULL,
  blocks integer,
  source text NOT NULL DEFAULT 'line_insight',
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS public.meta_ads_daily_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  insight_date date NOT NULL,
  spend numeric(12, 2) NOT NULL DEFAULT 0,
  impressions integer,
  clicks integer,
  reach integer,
  source text NOT NULL DEFAULT 'meta_api' CHECK (source IN ('meta_api', 'manual')),
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, insight_date)
);

CREATE TABLE IF NOT EXISTS public.marketing_report_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_kind text NOT NULL CHECK (report_kind IN ('daily', 'weekly')),
  period_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_kind, period_key)
);
