-- LINE 連携の入力→確認→確定のセッション保持
CREATE TABLE IF NOT EXISTS public.line_sessions (
  user_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('idle', 'confirm')),
  temp_member_id uuid NULL REFERENCES public.members (id) ON DELETE SET NULL,
  temp_member_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS line_sessions_status_idx ON public.line_sessions (status);
CREATE INDEX IF NOT EXISTS line_sessions_temp_member_id_idx ON public.line_sessions (temp_member_id);

