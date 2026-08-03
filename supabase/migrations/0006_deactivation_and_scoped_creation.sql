-- Wrapped in a transaction so this is all-or-nothing: if any statement
-- fails partway through, everything before it rolls back too - there is
-- no possible "half applied" state. Every individual statement is also
-- independently idempotent (DROP POLICY IF EXISTS before every CREATE
-- POLICY, CREATE OR REPLACE FUNCTION), so re-running this whole block
-- again after a successful run is also safe and a no-op.
begin;

-- Two things, in one batch per agreement:
--
-- 1. is_active retrofit. Discovered while designing deactivate-user: NO
--    RLS policy anywhere checks is_active - only the edge functions and
--    the client apps' one-time login-gate check it. Since RLS is
--    re-evaluated fresh on every single query (not cached from login),
--    an already-authenticated session for a deactivated staff member
--    could still read live data directly via the client SDK/Realtime
--    (e.g. a fired driver's app still streaming their assigned orders,
--    including customer phone numbers) even though every edge function
--    correctly rejects them. This migration adds a current_user_is_active()
--    helper and threads it into every staff-role-scoped policy (left
--    alone: customer self-access and public catalog reads - is_active
--    models employment status, not customer standing).
--
-- 2. Narrowed regional_manager/branch_manager role-assignment: switched
--    from a blocklist (role NOT IN [...]) to an explicit allowlist
--    (role IN [...]), matching create-user's authorization matrix exactly:
--      regional_manager can only assign branch_manager/dispatcher/driver
--      branch_manager   can only assign dispatcher/driver
--    call_center and team_leader are deliberately excluded from both -
--    only general_manager can create/assign those two, because they are
--    central roles not tied to a branch/region (see create-user/index.ts).

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(is_active, false) from public.users where id = auth.uid();
$$;

-- ============================================================================
-- 1. regions / branches / menu_* / sla_tiers (general_manager write policies)
-- ============================================================================
drop policy if exists "regions_write_general_manager" on public.regions;
create policy "regions_write_general_manager"
  on public.regions for all
  to authenticated
  using (current_user_role()::text = 'general_manager' and public.current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and public.current_user_is_active());

drop policy if exists "branches_write_general_manager" on public.branches;
create policy "branches_write_general_manager"
  on public.branches for all
  to authenticated
  using (current_user_role()::text = 'general_manager' and public.current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and public.current_user_is_active());

drop policy if exists "menu_categories_write_general_manager" on public.menu_categories;
create policy "menu_categories_write_general_manager"
  on public.menu_categories for all to authenticated
  using (current_user_role()::text = 'general_manager' and public.current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and public.current_user_is_active());

drop policy if exists "menu_items_write_general_manager" on public.menu_items;
create policy "menu_items_write_general_manager"
  on public.menu_items for all to authenticated
  using (current_user_role()::text = 'general_manager' and public.current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and public.current_user_is_active());

drop policy if exists "combo_offers_write_general_manager" on public.combo_offers;
create policy "combo_offers_write_general_manager"
  on public.combo_offers for all to authenticated
  using (current_user_role()::text = 'general_manager' and public.current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and public.current_user_is_active());

drop policy if exists "sla_tiers_write_general_manager" on public.sla_tiers;
create policy "sla_tiers_write_general_manager"
  on public.sla_tiers for all to authenticated
  using (current_user_role()::text = 'general_manager' and public.current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and public.current_user_is_active());

-- ============================================================================
-- 2. users
-- ============================================================================
drop policy if exists "users_select_general_manager_team_leader" on public.users;
create policy "users_select_general_manager_team_leader"
  on public.users for select
  to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader') and public.current_user_is_active());

drop policy if exists "users_select_regional_manager" on public.users;
create policy "users_select_regional_manager"
  on public.users for select
  to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and public.current_user_is_active()
    and branch_id in (select public.current_user_region_branch_ids())
  );

drop policy if exists "users_select_branch_manager" on public.users;
create policy "users_select_branch_manager"
  on public.users for select
  to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and public.current_user_is_active()
    and branch_id = current_user_branch_id()
  );

drop policy if exists "users_select_dispatcher_branch_drivers" on public.users;
create policy "users_select_dispatcher_branch_drivers"
  on public.users for select
  to authenticated
  using (
    current_user_role()::text = 'dispatcher'
    and public.current_user_is_active()
    and role = 'driver'
    and branch_id = current_user_branch_id()
  );

drop policy if exists "users_update_general_manager" on public.users;
create policy "users_update_general_manager"
  on public.users for update
  to authenticated
  using (current_user_role()::text = 'general_manager' and public.current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and public.current_user_is_active());

-- Narrowed to an explicit allowlist (was: role NOT IN [...]) - a
-- regional_manager could previously also assign 'call_center', which was
-- never intended (call_center/team_leader are general_manager-only).
drop policy if exists "users_update_regional_manager" on public.users;
create policy "users_update_regional_manager"
  on public.users for update
  to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and public.current_user_is_active()
    and branch_id in (select public.current_user_region_branch_ids())
  )
  with check (
    current_user_role()::text = 'regional_manager'
    and public.current_user_is_active()
    and branch_id in (select public.current_user_region_branch_ids())
    and role in ('branch_manager', 'dispatcher', 'driver')
  );

-- Same narrowing: a branch_manager could previously also assign
-- 'call_center'. Now only dispatcher/driver.
drop policy if exists "users_update_branch_manager" on public.users;
create policy "users_update_branch_manager"
  on public.users for update
  to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and public.current_user_is_active()
    and branch_id = current_user_branch_id()
  )
  with check (
    current_user_role()::text = 'branch_manager'
    and public.current_user_is_active()
    and branch_id = current_user_branch_id()
    and role in ('dispatcher', 'driver')
  );

-- ============================================================================
-- 3. customers_profile (staff-facing policies only - customer self-access
-- untouched, is_active models employment status not customer standing)
-- ============================================================================
drop policy if exists "customers_profile_select_staff" on public.customers_profile;
create policy "customers_profile_select_staff"
  on public.customers_profile for select
  to authenticated
  using (
    (current_user_role()::text in ('general_manager', 'team_leader', 'call_center') and public.current_user_is_active())
    or (current_user_role()::text = 'regional_manager' and public.current_user_is_active() and nearest_branch_id in (select public.current_user_region_branch_ids()))
    or (current_user_role()::text = 'branch_manager' and public.current_user_is_active() and nearest_branch_id = current_user_branch_id())
  );

drop policy if exists "customers_profile_write_call_center" on public.customers_profile;
create policy "customers_profile_write_call_center"
  on public.customers_profile for all
  to authenticated
  using (current_user_role()::text in ('call_center', 'general_manager', 'team_leader') and public.current_user_is_active())
  with check (current_user_role()::text in ('call_center', 'general_manager', 'team_leader') and public.current_user_is_active());

-- ============================================================================
-- 4. orders (staff-facing policies only - customer self-access untouched)
-- ============================================================================
drop policy if exists "orders_select_general_manager_team_leader" on public.orders;
create policy "orders_select_general_manager_team_leader"
  on public.orders for select to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader') and public.current_user_is_active());

drop policy if exists "orders_select_regional_manager" on public.orders;
create policy "orders_select_regional_manager"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and public.current_user_is_active()
    and branch_id in (select public.current_user_region_branch_ids())
  );

drop policy if exists "orders_select_branch_manager" on public.orders;
create policy "orders_select_branch_manager"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and public.current_user_is_active()
    and branch_id = current_user_branch_id()
  );

-- This is the policy directly behind the scenario you described: without
-- this, a deactivated driver's already-open app keeps seeing their
-- assigned orders (customer phone included) via Realtime until their
-- token can no longer refresh - now it's cut off on their very next query.
drop policy if exists "orders_select_dispatcher" on public.orders;
create policy "orders_select_dispatcher"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'dispatcher'
    and public.current_user_is_active()
    and branch_id = current_user_branch_id()
  );

drop policy if exists "orders_select_call_center" on public.orders;
create policy "orders_select_call_center"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'call_center'
    and public.current_user_is_active()
    and order_source = 'call_center'
  );

drop policy if exists "orders_select_driver" on public.orders;
create policy "orders_select_driver"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'driver'
    and public.current_user_is_active()
    and driver_id = auth.uid()
  );

drop policy if exists "orders_insert_call_center" on public.orders;
create policy "orders_insert_call_center"
  on public.orders for insert to authenticated
  with check (
    current_user_role()::text in ('call_center', 'general_manager', 'team_leader')
    and public.current_user_is_active()
    and order_source = 'call_center'
    and status = 'pending_acceptance'
  );

-- ============================================================================
-- 5. complaints (staff-facing policies only)
-- ============================================================================
drop policy if exists "complaints_select_general_manager_team_leader" on public.complaints;
create policy "complaints_select_general_manager_team_leader"
  on public.complaints for select to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader') and public.current_user_is_active());

drop policy if exists "complaints_select_regional_manager" on public.complaints;
create policy "complaints_select_regional_manager"
  on public.complaints for select to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and public.current_user_is_active()
    and branch_id in (select public.current_user_region_branch_ids())
  );

drop policy if exists "complaints_select_branch_manager" on public.complaints;
create policy "complaints_select_branch_manager"
  on public.complaints for select to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and public.current_user_is_active()
    and branch_id = current_user_branch_id()
  );

drop policy if exists "complaints_insert_staff" on public.complaints;
create policy "complaints_insert_staff"
  on public.complaints for insert to authenticated
  with check (
    (current_user_role()::text in ('general_manager', 'team_leader', 'call_center') and public.current_user_is_active())
    or (
      current_user_role()::text = 'regional_manager'
      and public.current_user_is_active()
      and exists (
        select 1 from public.orders o
        where o.id = complaints.order_id
          and o.branch_id in (select public.current_user_region_branch_ids())
      )
    )
    or (
      current_user_role()::text = 'branch_manager'
      and public.current_user_is_active()
      and exists (
        select 1 from public.orders o
        where o.id = complaints.order_id and o.branch_id = current_user_branch_id()
      )
    )
  );

drop policy if exists "complaints_insert_driver" on public.complaints;
create policy "complaints_insert_driver"
  on public.complaints for insert to authenticated
  with check (
    current_user_role()::text = 'driver'
    and public.current_user_is_active()
    and exists (select 1 from public.orders o where o.id = complaints.order_id and o.driver_id = auth.uid())
  );

drop policy if exists "complaints_update_general_manager_team_leader" on public.complaints;
create policy "complaints_update_general_manager_team_leader"
  on public.complaints for update to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader') and public.current_user_is_active())
  with check (current_user_role()::text in ('general_manager', 'team_leader') and public.current_user_is_active());

drop policy if exists "complaints_update_regional_manager" on public.complaints;
create policy "complaints_update_regional_manager"
  on public.complaints for update to authenticated
  using (current_user_role()::text = 'regional_manager' and public.current_user_is_active() and branch_id in (select public.current_user_region_branch_ids()))
  with check (current_user_role()::text = 'regional_manager' and public.current_user_is_active() and branch_id in (select public.current_user_region_branch_ids()));

drop policy if exists "complaints_update_branch_manager" on public.complaints;
create policy "complaints_update_branch_manager"
  on public.complaints for update to authenticated
  using (current_user_role()::text = 'branch_manager' and public.current_user_is_active() and branch_id = current_user_branch_id())
  with check (current_user_role()::text = 'branch_manager' and public.current_user_is_active() and branch_id = current_user_branch_id());

-- ============================================================================
-- 6. storage (receipts / payment-proofs) - only the staff branch of each
-- policy gets is_active added; the customer/self branch on payment-proofs
-- is untouched for the same reason as customers_profile above.
-- ============================================================================
drop policy if exists "receipts_insert_dispatcher" on storage.objects;
create policy "receipts_insert_dispatcher"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and current_user_role()::text = 'dispatcher'
    and public.current_user_is_active()
    and (storage.foldername(name))[1] = current_user_branch_id()::text
  );

drop policy if exists "receipts_select_scoped" on storage.objects;
create policy "receipts_select_scoped"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and public.current_user_is_active()
    and (
      current_user_role()::text in ('general_manager', 'team_leader')
      or (
        current_user_role()::text = 'regional_manager'
        and (storage.foldername(name))[1]::int in (select public.current_user_region_branch_ids())
      )
      or (
        current_user_role()::text in ('branch_manager', 'dispatcher')
        and (storage.foldername(name))[1]::int = current_user_branch_id()
      )
    )
  );

drop policy if exists "payment_proofs_insert_owner_or_staff" on storage.objects;
create policy "payment_proofs_insert_owner_or_staff"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (current_user_role()::text in ('call_center', 'general_manager', 'team_leader') and public.current_user_is_active())
    )
  );

drop policy if exists "payment_proofs_select_owner_or_staff" on storage.objects;
create policy "payment_proofs_select_owner_or_staff"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (current_user_role()::text in ('call_center', 'general_manager', 'team_leader') and public.current_user_is_active())
    )
  );

-- ============================================================================
-- 7. customer_addresses (0005) - guarded so this migration doesn't error
-- out if 0005 hasn't been applied yet. Driver policies + call_center
-- policy only; customer self-access untouched.
-- ============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'customer_addresses') then

    drop policy if exists "customer_addresses_manage_call_center" on public.customer_addresses;
    create policy "customer_addresses_manage_call_center"
      on public.customer_addresses for all to authenticated
      using (current_user_role()::text in ('call_center', 'general_manager', 'team_leader') and public.current_user_is_active())
      with check (current_user_role()::text in ('call_center', 'general_manager', 'team_leader') and public.current_user_is_active());

    drop policy if exists "customer_addresses_select_driver_current_order" on public.customer_addresses;
    create policy "customer_addresses_select_driver_current_order"
      on public.customer_addresses for select to authenticated
      using (
        current_user_role()::text = 'driver'
        and public.current_user_is_active()
        and exists (
          select 1 from public.orders o
          where o.address_id = customer_addresses.id and o.driver_id = auth.uid()
        )
      );

    drop policy if exists "customer_addresses_update_driver_current_order" on public.customer_addresses;
    create policy "customer_addresses_update_driver_current_order"
      on public.customer_addresses for update to authenticated
      using (
        current_user_role()::text = 'driver'
        and public.current_user_is_active()
        and exists (
          select 1 from public.orders o
          where o.address_id = customer_addresses.id and o.driver_id = auth.uid()
        )
      )
      with check (
        current_user_role()::text = 'driver'
        and public.current_user_is_active()
        and exists (
          select 1 from public.orders o
          where o.address_id = customer_addresses.id and o.driver_id = auth.uid()
        )
      );

  end if;
end $$;

commit;
