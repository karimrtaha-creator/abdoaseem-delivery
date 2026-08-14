-- Security audit finding L-01 (2026-08-14): verify-otp's wrong-guess path
-- used to read otp_codes.attempts, compute attempts+1 in the edge
-- function, then write that literal value back - a classic TOCTOU race.
-- Live-confirmed: 8 concurrent wrong-guess requests against one order
-- left the stored `attempts` at only 2, not 8 (six responses all
-- independently computed "4 remaining" from the same stale read), so
-- concurrent guessing gets meaningfully more real attempts than the
-- intended 5-guess limit before the counter reflects reality.
--
-- Fixed the same way check_rate_limit (0032) already fixes an identical
-- class of race for that table: a single UPDATE statement, guarded by a
-- WHERE clause, whose row lock forces concurrent callers on the same otp
-- row to serialize instead of interleaving a stale read with a write.
-- attempts is read and incremented in the same statement (never a
-- client-supplied "old value + 1"), and the `attempts < p_max_attempts`
-- guard means this can never push the counter past the max either.
--
-- Only touches the wrong-guess counting path - expired-code detection,
-- correct-code verification, and resend-otp are all untouched and keep
-- their existing behavior.
create or replace function public.record_otp_wrong_attempt(
  p_otp_id bigint,
  p_max_attempts int
) returns int
language sql
security definer
set search_path = public
as $$
  update public.otp_codes
  set attempts = attempts + 1
  where id = p_otp_id
    and verified_at is null
    and attempts < p_max_attempts
  returning attempts;
$$;

-- service_role already has EXECUTE via 0004's blanket grant (both the
-- explicit grant and the default-privileges rule cover this new
-- function); no client-facing role needs to call this directly, so no
-- grant to anon/authenticated is added - matches check_rate_limit's own
-- posture after 0050.
