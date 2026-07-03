-- 会員ステータス: 入会中 / 休会中 / 退会

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS membership_status text NOT NULL DEFAULT 'active'
    CHECK (membership_status IN ('active', 'hiatus', 'withdrawn'));

COMMENT ON COLUMN public.members.membership_status IS
  '会員ステータス: active=入会中, hiatus=休会中, withdrawn=退会';

-- 既存データ: is_active=false は退会として扱う
UPDATE public.members
SET membership_status = CASE
  WHEN is_active IS TRUE THEN 'active'
  ELSE 'withdrawn'
END
WHERE membership_status = 'active' AND is_active IS NOT TRUE;

CREATE INDEX IF NOT EXISTS members_membership_status_idx
  ON public.members (membership_status);
