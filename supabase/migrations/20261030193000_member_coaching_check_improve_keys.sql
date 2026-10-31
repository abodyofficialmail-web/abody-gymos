-- 会員ごとの改善点を、提案のチェック項目として残せるようにする。

ALTER TABLE public.member_coaching_checks
  DROP CONSTRAINT IF EXISTS member_coaching_checks_action_chk;

ALTER TABLE public.member_coaching_checks
  ADD CONSTRAINT member_coaching_checks_action_chk
  CHECK (
    action_key IN ('ticket', 'next_booking', 'proposal', 'motivation')
    OR action_key ~ '^imp_[0-9a-f]{8}$'
  );
