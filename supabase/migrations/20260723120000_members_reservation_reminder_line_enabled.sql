-- 会員向け予約リマインドLINE（60分前）の ON/OFF
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS reservation_reminder_line_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.members.reservation_reminder_line_enabled IS
  '会員向け予約リマインドLINE（60分前）のON/OFF。予約確定・変更・カルテ等は対象外';
