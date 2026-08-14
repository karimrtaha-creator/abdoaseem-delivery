-- Security audit finding M-01 (2026-08-14): neither app ever wrapped
-- Supabase Auth's own signInWithPassword() in an edge function - both call
-- it directly from the client - so the project's existing rate-limit
-- architecture (check_rate_limit/rate_limits, 0032) had no attachment
-- point for login at all. Live-confirmed: 25 consecutive wrong-password
-- attempts against one disposable account all returned HTTP 400 with no
-- throttling whatsoever.
--
-- Fixed via Supabase Auth's native "Password Verification Attempt" hook
-- (wired in config.toml) instead of adding a login-proxy edge function -
-- this needs zero frontend changes in either app (both keep calling
-- signInWithPassword exactly as before), and GoTrue invokes it
-- synchronously on every password-based sign-in attempt before deciding
-- success/failure, giving a real server-side enforcement point that
-- can't be bypassed by calling the Auth API directly either.
--
-- Counts every attempt (right or wrong) toward the same budget, not just
-- wrong ones - a brute-force run's eventual correct guess must be capped
-- too, or the limit protects nothing. 5 attempts / 5 minutes per account
-- is generous for a human mistyping their own password a few times
-- (regression-tested: a few wrong guesses then the right one still
-- succeeds) while making online guessing against one account
-- impractical. Self-resetting fixed window (same table/function as
-- everywhere else) - never a permanent lock an admin would need to clear.
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id text := event->>'user_id';
  v_within_limit boolean;
begin
  -- No user_id in the payload (shouldn't happen for this hook) - don't
  -- block on something we can't key a limit on.
  if v_user_id is null then
    return jsonb_build_object('decision', 'continue');
  end if;

  select public.check_rate_limit('login-attempt:' || v_user_id, 300, 5) into v_within_limit;
  if not v_within_limit then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Too many login attempts for this account. Please wait a few minutes and try again.'
    );
  end if;

  return jsonb_build_object('decision', 'continue');
end;
$$;

-- GoTrue invokes Postgres hooks as supabase_auth_admin - matches the
-- convention Supabase's own hook docs use, distinct from the
-- authenticated/anon/PUBLIC revoke in 0050 (this function is never
-- reachable via PostgREST/RPC at all, no HTTP route calls it directly).
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
