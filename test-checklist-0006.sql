-- Run each block separately (or all together - each is self-contained
-- with its own BEGIN/ROLLBACK). Nothing here permanently changes data;
-- every block ends with ROLLBACK on purpose.

-- ============================================================================
-- 0. PROOF the impersonation is real, not bypassed - run this FIRST and
-- read the output before trusting anything below. You're connected as
-- `postgres` (superuser -> bypasses RLS automatically, no exceptions).
-- `SET LOCAL ROLE authenticated` genuinely switches the active
-- privilege-checking identity for the rest of this transaction - not just
-- a GUC variable, the real thing Postgres uses to decide whether RLS
-- applies. This block proves that switch actually happened before you
-- trust any SELECT result as meaning something.
-- ============================================================================
begin;
select current_user as before_switch; -- expect: postgres

set local role authenticated;
select current_user as after_switch; -- expect: authenticated (NOT postgres)

-- expect: rolsuper=false, rolbypassrls=false for the *authenticated* role
-- (contrast with postgres, which would show true/true) - this is what
-- actually forces RLS to be evaluated instead of skipped.
select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user;

rollback;
-- If before_switch wasn't 'postgres', or after_switch wasn't
-- 'authenticated', or rolbypassrls wasn't false - STOP. The tests below
-- are not meaningful until this block shows exactly that.

-- ============================================================================
-- A. Dispatcher still sees their branch's orders (regression check)
-- ============================================================================
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '26117d48-221d-4430-990b-652c80c2003a', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- Expect: zero errors, and every row's branch_id = 1 (the test dispatcher's
-- branch) - no rows from any other branch, and no permission-denied error.
select id, status, branch_id from public.orders;
rollback;

-- ============================================================================
-- B. Driver still sees their own assigned orders (regression check)
-- ============================================================================
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '50ec4a93-f458-4834-8de2-aabdaa14efc0', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- Expect: zero errors, and every row's driver_id = the test driver's id -
-- no rows assigned to any other driver.
select id, status, driver_id from public.orders;
rollback;

-- ============================================================================
-- C. call_center can still see/insert call-center orders (regression
-- check on the RLS layer only - this does NOT exercise the create-order
-- edge function itself, since that function uses service_role and
-- bypasses RLS entirely. I'll test the real function end-to-end myself
-- right after you run the migration; this block just confirms the
-- underlying policy a direct insert would need is still intact.)
-- ============================================================================
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '4ed9019b-de58-43dd-8e9c-dc95835ffb18', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- Expect: zero errors, and rows only where order_source = 'call_center'.
select id, status, order_source from public.orders;

-- Expect: succeeds (no permission-denied) - proves the INSERT policy
-- still accepts a call_center-sourced order shape. Rolled back either way.
insert into public.orders (order_source, branch_id, customer_phone, status, order_time, payment_method)
values ('call_center', 1, '01000000000', 'pending_acceptance', now(), 'cash');
rollback;

-- ============================================================================
-- D. The NEW protection actually works (not just "nothing broke") -
-- temporarily deactivates the test dispatcher, confirms they lose access,
-- then rolls back so is_active is never actually changed for real.
-- ============================================================================
begin;
update public.users set is_active = false where id = '26117d48-221d-4430-990b-652c80c2003a';

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '26117d48-221d-4430-990b-652c80c2003a', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- Expect: ZERO rows (not an error - RLS silently returns nothing, which
-- is correct RLS behavior). If this still returns branch 1's orders,
-- the is_active retrofit did not take effect and you should NOT proceed
-- to deploy create-user/deactivate-user until this is fixed.
select id, status, branch_id from public.orders;

rollback; -- test dispatcher's is_active is back to true, nothing kept
