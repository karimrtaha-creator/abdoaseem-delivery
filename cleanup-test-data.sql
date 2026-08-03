-- Removes tonight's test orders (1-7) and the guest test customers they
-- created, WITHOUT touching the staff test accounts (driver/dispatcher/
-- call_center - those have role != 'customer', so they're structurally
-- excluded by every WHERE clause below, not just skipped by convention).
--
-- Run this whole block as one script (one SQL Editor "Run") so the
-- temporary table survives across all the statements.

begin;

-- Capture which customer_id values orders 1-7 actually used, before we
-- delete the orders and lose that information.
create temporary table _cleanup_customer_ids as
select distinct customer_id
from public.orders
where id between 1 and 7 and customer_id is not null;

-- complaints has a FK to orders.id - must go before orders is deleted.
-- (This is also where the pre-fix lockout/resend-limit complaints from
-- tonight's testing live - see the verify-otp/resend-otp discussion above.)
delete from public.complaints where order_id between 1 and 7;

delete from public.order_items where order_id between 1 and 7;
delete from public.otp_codes where order_id between 1 and 7;
delete from public.orders where id between 1 and 7;

-- customer_addresses only exists if migration 0005 has been applied -
-- guarded so this script doesn't error out if it hasn't been run yet.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'customer_addresses') then
    delete from public.customer_addresses
    where user_id in (select customer_id from _cleanup_customer_ids)
      and user_id in (select id from public.users where role = 'customer');
  end if;
end $$;

delete from public.customers_profile
where user_id in (select customer_id from _cleanup_customer_ids)
  and user_id in (select id from public.users where role = 'customer');

delete from public.users
where id in (select customer_id from _cleanup_customer_ids)
  and role = 'customer';

-- Optional: also drops the matching auth.users rows so no orphaned guest
-- Auth accounts are left behind (create-order made a real auth user for
-- each guest customer). Safe to comment this block out and instead delete
-- these same accounts by hand from Dashboard -> Authentication -> Users
-- if you'd rather not run a raw DELETE against the auth schema.
delete from auth.users
where id in (select customer_id from _cleanup_customer_ids);

drop table _cleanup_customer_ids;

commit;
