-- 予約止めを提案中の印。日付の×とは別に、カルテと予約から見えるようにする。
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS booking_stop_proposed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.members.booking_stop_proposed IS
  'スタッフ向け。連続予約を止める提案中。会員の予約画面には出さない';
