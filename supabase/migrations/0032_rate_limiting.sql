-- Finding #001 (security audit, 2026-08-11): no rate limiting existed on
-- any edge function except verify-otp/resend-otp's own OTP-attempt
-- counters (untouched here - they already work correctly and are out of
-- scope for this fix).
--
-- Fixed-window counter, keyed by whatever the caller passes (edge
-- functions build the key as "<endpoint>:<user_id>", combining
-- authenticated identity with the endpoint - every one of the endpoints
-- this gets attached to already requires a real session, so per-user is
-- the meaningful signal here, not per-IP; a NAT'd office of legitimate
-- staff sharing one IP must never get blocked by each other's actions).
--
-- The atomicity requirement (concurrent requests must not all sneak
-- through under a shared limit) is handled by check_rate_limit being a
-- single INSERT ... ON CONFLICT DO UPDATE statement - Postgres takes a
-- row lock on the conflicting key for the duration of that one
-- statement, so concurrent callers serialize on the same counter row
-- instead of racing past it.
create table if not exists public.rate_limits (
  key text not null,
  window_start bigint not null, -- unix seconds, floored to the window size
  count int not null default 1,
  primary key (key, window_start)
);

-- service_role only (edge functions use the admin client) - no client-
-- facing grant at all, this table has nothing a browser should ever
-- touch directly.
alter table public.rate_limits enable row level security;

create or replace function public.check_rate_limit(
  p_key text,
  p_window_seconds int,
  p_max_requests int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start bigint;
  v_count int;
begin
  v_window_start := (extract(epoch from now())::bigint / p_window_seconds) * p_window_seconds;

  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start)
  do update set count = rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_max_requests;
end;
$$;

-- Old windows accumulate one row per key per window - this keeps the
-- table from growing forever. Runs alongside the existing SLA/proximity
-- cron jobs, well within their every-1-2-minutes cadence being harmless
-- for a daily sweep.
select cron.schedule(
  'cleanup-rate-limits-daily',
  '0 3 * * *',
  $$ delete from public.rate_limits where window_start < extract(epoch from now() - interval '1 day')::bigint; $$
);
