-- 会員プラン（Google Sheets data!C列と同期: '4' | '8' | 'unlimited'）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS plan text
    CHECK (plan IS NULL OR plan IN ('4', '8', 'unlimited'));

COMMENT ON COLUMN public.members.plan IS
  '会員プラン: 4=4枠, 8=8枠, unlimited=60分通い放題（Sheets data!C列）';

CREATE INDEX IF NOT EXISTS members_plan_idx ON public.members (plan);
