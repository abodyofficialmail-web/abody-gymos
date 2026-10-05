-- 入会コース（月4回・月8回）と、紹介者・着替え・食事パーソナルの入会記録
ALTER TABLE public.members
  DROP CONSTRAINT IF EXISTS members_membership_plan_check;

ALTER TABLE public.members
  ADD CONSTRAINT members_membership_plan_check
    CHECK (
      membership_plan IS NULL
      OR membership_plan IN (
        'unlimited_30',
        'session_60',
        'monthly_4',
        'monthly_8',
        'monthly_10',
        'monthly_20',
        'ticket',
        'this_month_10'
      )
    );

COMMENT ON COLUMN public.members.membership_plan IS
  '会員プラン: unlimited_30 / session_60 / monthly_4 / monthly_8 / monthly_10 / monthly_20 / ticket / this_month_10';

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS referrer_member_id uuid REFERENCES public.members (id) ON DELETE SET NULL;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS has_changing_clothes_plan boolean;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS has_meal_personal boolean;

COMMENT ON COLUMN public.members.referrer_member_id IS
  '紹介キャンペーンの紹介者（会員）';
COMMENT ON COLUMN public.members.has_changing_clothes_plan IS
  '入会オプション: 着替えプランの有無';
COMMENT ON COLUMN public.members.has_meal_personal IS
  '入会オプション: 食事パーソナルの契約有無（課金パスとは別）';
