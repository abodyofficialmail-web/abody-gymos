-- 退会日・退会時担当トレーナー

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS withdrawn_at date,
  ADD COLUMN IF NOT EXISTS withdrawn_trainer_id uuid REFERENCES public.trainers (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.members.withdrawn_at IS '退会日';
COMMENT ON COLUMN public.members.withdrawn_trainer_id IS '退会時担当トレーナー';

CREATE INDEX IF NOT EXISTS members_withdrawn_at_idx
  ON public.members (withdrawn_at DESC)
  WHERE membership_status = 'withdrawn';
