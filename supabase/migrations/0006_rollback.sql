-- Rollback for 0006_deactivation_and_scoped_creation.sql.
--
-- Restores every policy 0006 touched to EXACTLY its pre-0006 definition -
-- this text is copied verbatim from the current 0001_rls_policies.sql /
-- 0003_storage_policies.sql / 0005_customer_addresses.sql, not
-- reconstructed from memory, so it reproduces the original behavior
-- precisely (including users_update_regional_manager/branch_manager going
-- back to the original blocklist form, not the new allowlist).
--
-- Untouched by 0006 (customer self-access, public catalog reads, etc.)
-- needs no rollback - only what 0006 changed is restored here.
--
-- Wrapped in a transaction: all-or-nothing, same reasoning as 0006 itself.
-- Safe to run even if 0006 was only partially applied (every statement
-- here is DROP POLICY IF EXISTS + CREATE POLICY, so it unconditionally
-- overwrites whatever state exists) and safe to run more than once.

begin;

-- ============================================================================
-- 1. regions / branches / menu_* / sla_tiers
-- ============================================================================
drop policy if exists "regions_write_general_manager" on public.regions;
create policy "regions_write_general_manager"
  on public.regions for all
  to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "branches_write_general_manager" on public.branches;
create policy "branches_write_general_manager"
  on public.branches for all
  to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "menu_categories_write_general_manager" on public.menu_categories;
create policy "menu_categories_write_general_manager"
  on public.menu_categories for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "menu_items_write_general_manager" on public.menu_items;
create policy "menu_items_write_general_manager"
  on public.menu_items for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "combo_offers_write_general_manager" on public.combo_offers;
create policy "combo_offers_write_general_manager"
  on public.combo_offers for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "sla_tiers_write_general_manager" on public.sla_tiers;
create policy "sla_tiers_write_general_manager"
  on public.sla_tiers for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

-- ============================================================================
-- 2. users
-- ============================================================================
drop policy if exists "users_select_general_manager_team_leader" on public.users;
create policy "users_select_general_manager_team_leader"
  on public.users for select
  to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader'));

drop policy if exists "users_select_regional_manager" on public.users;
create policy "users_select_regional_manager"
  on public.users for select
  to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and branch_id in (select public.current_user_region_branch_ids())
  );

drop policy if exists "users_select_branch_manager" on public.users;
create policy "users_select_branch_manager"
  on public.users for select
  to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and branch_id = current_user_branch_id()
  );

drop policy if exists "users_select_dispatcher_branch_drivers" on public.users;
create policy "users_select_dispatcher_branch_drivers"
  on public.users for select
  to authenticated
  using (
    current_user_role()::text = 'dispatcher'
    and role = 'driver'
    and branch_id = current_user_branch_id()
  );

drop policy if exists "users_update_general_manager" on public.users;
create policy "users_update_general_manager"
  on public.users for update
  to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "users_update_regional_manager" on public.users;
create policy "users_update_regional_manager"
  on public.users for update
  to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and branch_id in (select public.current_user_region_branch_ids())
  )
  with check (
    current_user_role()::text = 'regional_manager'
    and branch_id in (select public.current_user_region_branch_ids())
    and role not in ('general_manager', 'regional_manager', 'team_leader')
  );

drop policy if exists "users_update_branch_manager" on public.users;
create policy "users_update_branch_manager"
  on public.users for update
  to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and branch_id = current_user_branch_id()
  )
  with check (
    current_user_role()::text = 'branch_manager'
    and branch_id = current_user_branch_id()
    and role not in ('general_manager', 'regional_manager', 'team_leader', 'branch_manager')
  );

-- ============================================================================
-- 3. customers_profile
-- ============================================================================
drop policy if exists "customers_profile_select_staff" on public.customers_profile;
create policy "customers_profile_select_staff"
  on public.customers_profile for select
  to authenticated
  using (
    current_user_role()::text in ('general_manager', 'team_leader', 'call_center')
    or (current_user_role()::text = 'regional_manager' and nearest_branch_id in (select public.current_user_region_branch_ids()))
    or (current_user_role()::text = 'branch_manager' and nearest_branch_id = current_user_branch_id())
  );

drop policy if exists "customers_profile_write_call_center" on public.customers_profile;
create policy "customers_profile_write_call_center"
  on public.customers_profile for all
  to authenticated
  using (current_user_role()::text in ('call_center', 'general_manager', 'team_leader'))
  with check (current_user_role()::text in ('call_center', 'general_manager', 'team_leader'));

-- ============================================================================
-- 4. orders
-- ============================================================================
drop policy if exists "orders_select_general_manager_team_leader" on public.orders;
create policy "orders_select_general_manager_team_leader"
  on public.orders for select to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader'));

drop policy if exists "orders_select_regional_manager" on public.orders;
create policy "orders_select_regional_manager"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and branch_id in (select public.current_user_region_branch_ids())
  );

drop policy if exists "orders_select_branch_manager" on public.orders;
create policy "orders_select_branch_manager"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and branch_id = current_user_branch_id()
  );

drop policy if exists "orders_select_dispatcher" on public.orders;
create policy "orders_select_dispatcher"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'dispatcher'
    and branch_id = current_user_branch_id()
  );

drop policy if exists "orders_select_call_center" on public.orders;
create policy "orders_select_call_center"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'call_center'
    and order_source = 'call_center'
  );

drop policy if exists "orders_select_driver" on public.orders;
create policy "orders_select_driver"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'driver'
    and driver_id = auth.uid()
  );

drop policy if exists "orders_insert_call_center" on public.orders;
create policy "orders_insert_call_center"
  on public.orders for insert to authenticated
  with check (
    current_user_role()::text in ('call_center', 'general_manager', 'team_leader')
    and order_source = 'call_center'
    and status = 'pending_acceptance'
  );

-- ============================================================================
-- 5. complaints
-- ============================================================================
drop policy if exists "complaints_select_general_manager_team_leader" on public.complaints;
create policy "complaints_select_general_manager_team_leader"
  on public.complaints for select to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader'));

drop policy if exists "complaints_select_regional_manager" on public.complaints;
create policy "complaints_select_regional_manager"
  on public.complaints for select to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and branch_id in (select public.current_user_region_branch_ids())
  );

drop policy if exists "complaints_select_branch_manager" on public.complaints;
create policy "complaints_select_branch_manager"
  on public.complaints for select to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and branch_id = current_user_branch_id()
  );

drop policy if exists "complaints_insert_staff" on public.complaints;
create policy "complaints_insert_staff"
  on public.complaints for insert to authenticated
  with check (
    current_user_role()::text in ('general_manager', 'team_leader', 'call_center')
    or (
      current_user_role()::text = 'regional_manager'
      and exists (
        select 1 from public.orders o
        where o.id = complaints.order_id
          and o.branch_id in (select public.current_user_region_branch_ids())
      )
    )
    or (
      current_user_role()::text = 'branch_manager'
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
    and exists (select 1 from public.orders o where o.id = complaints.order_id and o.driver_id = auth.uid())
  );

drop policy if exists "complaints_update_general_manager_team_leader" on public.complaints;
create policy "complaints_update_general_manager_team_leader"
  on public.complaints for update to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader'))
  with check (current_user_role()::text in ('general_manager', 'team_leader'));

drop policy if exists "complaints_update_regional_manager" on public.complaints;
create policy "complaints_update_regional_manager"
  on public.complaints for update to authenticated
  using (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
  with check (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()));

drop policy if exists "complaints_update_branch_manager" on public.complaints;
create policy "complaints_update_branch_manager"
  on public.complaints for update to authenticated
  using (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
  with check (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id());

-- ============================================================================
-- 6. storage (receipts / payment-proofs)
-- ============================================================================
drop policy if exists "receipts_insert_dispatcher" on storage.objects;
create policy "receipts_insert_dispatcher"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and current_user_role()::text = 'dispatcher'
    and (storage.foldername(name))[1] = current_user_branch_id()::text
  );

drop policy if exists "receipts_select_scoped" on storage.objects;
create policy "receipts_select_scoped"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
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
      or current_user_role()::text in ('call_center', 'general_manager', 'team_leader')
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
      or current_user_role()::text in ('call_center', 'general_manager', 'team_leader')
    )
  );

-- ============================================================================
-- 7. customer_addresses (0005) - guarded so this doesn't error out if 0005
-- was never applied.
-- ============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'customer_addresses') then

    drop policy if exists "customer_addresses_manage_call_center" on public.customer_addresses;
    create policy "customer_addresses_manage_call_center"
      on public.customer_addresses for all to authenticated
      using (current_user_role()::text in ('call_center', 'general_manager', 'team_leader'))
      with check (current_user_role()::text in ('call_center', 'general_manager', 'team_leader'));

    drop policy if exists "customer_addresses_select_driver_current_order" on public.customer_addresses;
    create policy "customer_addresses_select_driver_current_order"
      on public.customer_addresses for select to authenticated
      using (
        current_user_role()::text = 'driver'
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
        and exists (
          select 1 from public.orders o
          where o.address_id = customer_addresses.id and o.driver_id = auth.uid()
        )
      )
      with check (
        current_user_role()::text = 'driver'
        and exists (
          select 1 from public.orders o
          where o.address_id = customer_addresses.id and o.driver_id = auth.uid()
        )
      );

  end if;
end $$;

-- ============================================================================
-- 8. drop the now-unreferenced helper (safe: nothing above uses it anymore)
-- ============================================================================
drop function if exists public.current_user_is_active();

commit;
