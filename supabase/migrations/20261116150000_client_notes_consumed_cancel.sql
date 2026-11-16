-- 当日キャンセルの予約消化。通常のカルテ送信（note_kind = session）とは別で、送信率に含めない。
ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS note_kind text NOT NULL DEFAULT 'session';

COMMENT ON COLUMN public.client_notes.note_kind IS
  'session: 通常のカルテ送信。consumed_cancel: 当日キャンセルの予約消化。送信率には含めない。';
