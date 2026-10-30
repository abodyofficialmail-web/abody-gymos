-- 来店が少ない会員への提案を、誰が実施したか残す。

CREATE TABLE IF NOT EXISTS public.member_coaching_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  year_month text NOT NULL,
  action_key text NOT NULL,
  trainer_id uuid REFERENCES public.trainers (id) ON DELETE SET NULL,
  trainer_name text NOT NULL DEFAULT '',
  done_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_coaching_checks_month_chk CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT member_coaching_checks_action_chk CHECK (
    action_key IN ('ticket', 'next_booking', 'proposal', 'motivation')
  ),
  CONSTRAINT member_coaching_checks_member_month_action_key UNIQUE (member_id, year_month, action_key)
);

COMMENT ON TABLE public.member_coaching_checks IS
  '来店が少ない会員への提案を、実施したトレーナーと日時で残す';

CREATE INDEX IF NOT EXISTS member_coaching_checks_member_month_idx
  ON public.member_coaching_checks (member_id, year_month);
