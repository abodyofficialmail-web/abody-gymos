-- 食事パーソナル月額オプション（Stripe・出勤表示パスと同じ仕組み）
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS meal_personal_pass_status text NOT NULL DEFAULT 'inactive';

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS meal_personal_stripe_customer_id text;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS meal_personal_stripe_subscription_id text;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS meal_personal_pass_current_period_end timestamptz;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS meal_personal_pass_email text;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS meal_personal_pass_activated_at timestamptz;

COMMENT ON COLUMN public.members.meal_personal_pass_status IS
  '食事パーソナル Stripe サブスク状態。active/trialing/past_due など。未契約は inactive';

COMMENT ON COLUMN public.members.meal_personal_stripe_customer_id IS
  'Stripe Customer ID（cus_...）';

COMMENT ON COLUMN public.members.meal_personal_stripe_subscription_id IS
  'Stripe Subscription ID（sub_...）';

COMMENT ON COLUMN public.members.meal_personal_pass_current_period_end IS
  '現在の課金期間終了時刻。解約後もここまでは全機能を利用可';

COMMENT ON COLUMN public.members.meal_personal_pass_email IS
  'Stripe 決済で使ったメール。会員登録メールと違う場合もある';

CREATE INDEX IF NOT EXISTS members_meal_personal_stripe_customer_id_idx
  ON public.members (meal_personal_stripe_customer_id)
  WHERE meal_personal_stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS members_meal_personal_stripe_subscription_id_idx
  ON public.members (meal_personal_stripe_subscription_id)
  WHERE meal_personal_stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.meal_personal_pass_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  member_id uuid,
  member_code text,
  stripe_email text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_session_id text,
  status text,
  detail jsonb
);

CREATE INDEX IF NOT EXISTS meal_personal_pass_events_created_at_idx
  ON public.meal_personal_pass_events (created_at DESC);

CREATE INDEX IF NOT EXISTS meal_personal_pass_events_member_id_idx
  ON public.meal_personal_pass_events (member_id)
  WHERE member_id IS NOT NULL;
