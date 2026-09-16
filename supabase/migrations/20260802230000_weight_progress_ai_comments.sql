-- 種目別・来月目標の LLM コメント（事前生成キャッシュ）
-- 数字自体はルール推定。ここは根拠文・トレーナー向け一言のみ。

CREATE TABLE IF NOT EXISTS public.member_weight_progress_ai_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  year_month text NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),
  exercise text NOT NULL,
  next_target numeric NOT NULL,
  rule_reason text,
  ai_rationale text NOT NULL DEFAULT '',
  trainer_tip text NOT NULL DEFAULT '',
  source_hash text NOT NULL,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, year_month, exercise)
);

CREATE INDEX IF NOT EXISTS member_weight_progress_ai_comments_member_ym_idx
  ON public.member_weight_progress_ai_comments (member_id, year_month DESC);

COMMENT ON TABLE public.member_weight_progress_ai_comments IS
  'Weight next-month target LLM comments (cached). Numbers come from rule engine.';
