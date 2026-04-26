-- 会員名（カルテ表示用）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS name text;

