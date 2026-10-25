-- セッション前ヒアリング: トレーニング / ストレッチ / どっちも（任意）

ALTER TABLE public.pre_session_survey_responses
  ADD COLUMN IF NOT EXISTS session_format text;

ALTER TABLE public.pre_session_survey_responses
  DROP CONSTRAINT IF EXISTS pre_session_survey_responses_session_format_check;

ALTER TABLE public.pre_session_survey_responses
  ADD CONSTRAINT pre_session_survey_responses_session_format_check
  CHECK (session_format IS NULL OR session_format IN ('training', 'stretch', 'both'));

COMMENT ON COLUMN public.pre_session_survey_responses.session_format IS
  '会員の希望。training=トレーニング / stretch=ストレッチ / both=どっちも。未回答は NULL';
