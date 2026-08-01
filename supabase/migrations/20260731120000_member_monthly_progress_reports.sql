-- 月次成長レポート（マイページ保存用メタデータ）
CREATE TABLE IF NOT EXISTS public.member_monthly_progress_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  year_month text NOT NULL,
  member_code text,
  visit_count integer,
  abody_score integer,
  overall_grade text,
  pdf_path text,
  page1_path text,
  page2_path text,
  page3_path text,
  page4_path text,
  storage_prefix text,
  line_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, year_month)
);

CREATE INDEX IF NOT EXISTS member_monthly_progress_reports_member_ym_idx
  ON public.member_monthly_progress_reports (member_id, year_month DESC);

-- PDF / JPEG 保存用 private バケット
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-reports',
  'member-reports',
  false,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'application/pdf', 'application/json']
)
ON CONFLICT (id) DO UPDATE
SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
