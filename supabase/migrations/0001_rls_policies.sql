-- ============================================================================
-- RLS policies for the ABDO ASEEM delivery system (spec section 3).
--
-- Assumes (already deployed, per project owner):
--   - current_user_role()        returns the caller's users.role (or NULL)
--   - current_user_branch_id()   returns the caller's users.branch_id (or NULL)
--   - current_user_region_id()   returns the caller's users.region_id (or NULL)
--   - public.users.id = auth.users.id (1:1 with Supabase Auth)
--
-- Auth strategy: staff sign in via Supabase Auth email+password using a
-- synthetic email derived from phone (e.g. "<phone>@abdoaseem.internal").
-- public.users.password_hash is therefore unused by the app (Auth owns
-- credentials); the column is left in place but nothing here reads/writes it.
--
-- Design notes:
--   - orders / otp_codes have NO client-facing UPDATE policy. All status
--     transitions (accept/reject, dispatch, OTP verify) happen exclusively
--     through the accept-order / dispatch-order / verify-otp / resend-otp
--     edge functions, which use the service_role key after re-checking the
--     caller's role themselves. This stops e.g. a driver PATCHing
--     delivered_time directly, or a dispatcher backdating dispatch_time.
--   - otp_codes has NO client-facing SELECT policy at all: if a driver could
--     read the code from the DB there would be no point asking the customer
--     for it verbally, defeating the anti-fraud purpose of OTP.
--   - Grants are explicit: a brand-new Supabase project gives `anon` and
--     `authenticated` zero table privileges until granted, independent of
--     RLS. Both layers are required together.
--   - Every CREATE POLICY is preceded by a matching DROP POLICY IF EXISTS,
--     so this file (and 0003_storage_policies.sql) can be re-run safely -
--     ALTER TABLE...ENABLE RLS, CREATE OR REPLACE FUNCTION and GRANT are
--     already idempotent on their own. This file never creates types,
--     tables, or seed rows - that schema/data already existed before this
--     migration was written, nothing here touches it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Enable RLS everywhere
-- ----------------------------------------------------------------------------
alter table public.regions            enable row level security;
alter table public.branches           enable row level security;
alter table public.users              enable row level security;
alter table public.customers_profile  enable row level security;
alter table public.menu_categories    enable row level security;
alter table public.menu_items         enable row level security;
alter table public.combo_offers       enable row level security;
alter table public.order_items        enable row level security;
alter table public.orders             enable row level security;
alter table public.sla_tiers          enable row level security;
alter table public.otp_codes          enable row level security;
alter table public.complaints         enable row level security;

-- ----------------------------------------------------------------------------
-- helper: branch ids inside the caller's region (used by regional_manager)
-- ----------------------------------------------------------------------------
create or replace function public.current_user_region_branch_ids()
returns setof int
language sql
stable
security definer
set search_path = public
as $$
  select id from public.branches where region_id = current_user_region_id();
$$;

-- ============================================================================
-- 1. regions
-- ============================================================================
grant select on public.regions to authenticated;
grant insert, update, delete on public.regions to authenticated; -- narrowed by policy

drop policy if exists "regions_select_authenticated" on public.regions;
create policy "regions_select_authenticated"
  on public.regions for select
  to authenticated
  using (true);

drop policy if exists "regions_write_general_manager" on public.regions;
create policy "regions_write_general_manager"
  on public.regions for all
  to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

-- ============================================================================
-- 2. branches
-- ============================================================================
grant select on public.branches to anon, authenticated;
grant insert, update, delete on public.branches to authenticated; -- narrowed by policy

drop policy if exists "branches_select_public" on public.branches;
create policy "branches_select_public"
  on public.branches for select
  to anon, authenticated
  using (true);

drop policy if exists "branches_write_general_manager" on public.branches;
create policy "branches_write_general_manager"
  on public.branches for all
  to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

-- ============================================================================
-- 3. users
-- ============================================================================
grant select, update on public.users to authenticated; -- insert happens via
                                                          -- auth.admin (service_role),
                                                          -- not client INSERT

drop policy if exists "users_select_self" on public.users;
create policy "users_select_self"
  on public.users for select
  to authenticated
  using (id = auth.uid());

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

-- Dispatcher needs to see their branch's drivers to populate the "select
-- driver" picker in the exit-confirmation screen (section 6). Scoped to
-- driver rows only, not the whole branch roster.
drop policy if exists "users_select_dispatcher_branch_drivers" on public.users;
create policy "users_select_dispatcher_branch_drivers"
  on public.users for select
  to authenticated
  using (
    current_user_role()::text = 'dispatcher'
    and role = 'driver'
    and branch_id = current_user_branch_id()
  );

-- Self profile edits (name only, in practice) - role/branch_id/region_id/
-- is_active changes are blocked for non-managers by the trigger below.
drop policy if exists "users_update_self" on public.users;
create policy "users_update_self"
  on public.users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

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

-- Prevent non-managers from promoting themselves via the "update own row" policy.
create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and current_user_role()::text not in ('general_manager', 'regional_manager', 'branch_manager') then
    if new.role is distinct from old.role
       or new.branch_id is distinct from old.branch_id
       or new.region_id is distinct from old.region_id
       or new.is_active is distinct from old.is_active then
      raise exception 'not allowed to change role/branch/region/active status on your own account';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_privilege_escalation on public.users;
create trigger trg_prevent_self_privilege_escalation
  before update on public.users
  for each row execute function public.prevent_self_privilege_escalation();

-- ============================================================================
-- 4. customers_profile
-- ============================================================================
grant select, insert, update on public.customers_profile to authenticated;

drop policy if exists "customers_profile_select_self" on public.customers_profile;
create policy "customers_profile_select_self"
  on public.customers_profile for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "customers_profile_select_staff" on public.customers_profile;
create policy "customers_profile_select_staff"
  on public.customers_profile for select
  to authenticated
  using (
    current_user_role()::text in ('general_manager', 'team_leader', 'call_center')
    or (current_user_role()::text = 'regional_manager' and nearest_branch_id in (select public.current_user_region_branch_ids()))
    or (current_user_role()::text = 'branch_manager' and nearest_branch_id = current_user_branch_id())
  );

drop policy if exists "customers_profile_upsert_self" on public.customers_profile;
create policy "customers_profile_upsert_self"
  on public.customers_profile for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "customers_profile_update_self" on public.customers_profile;
create policy "customers_profile_update_self"
  on public.customers_profile for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "customers_profile_write_call_center" on public.customers_profile;
create policy "customers_profile_write_call_center"
  on public.customers_profile for all
  to authenticated
  using (current_user_role()::text in ('call_center', 'general_manager', 'team_leader'))
  with check (current_user_role()::text in ('call_center', 'general_manager', 'team_leader'));

-- ============================================================================
-- 5. menu_categories / menu_items / combo_offers (public catalog)
-- ============================================================================
grant select on public.menu_categories, public.menu_items, public.combo_offers to anon, authenticated;
grant insert, update, delete on public.menu_categories, public.menu_items, public.combo_offers to authenticated; -- narrowed by policy

drop policy if exists "menu_categories_select_public" on public.menu_categories;
create policy "menu_categories_select_public" on public.menu_categories for select to anon, authenticated using (true);
drop policy if exists "menu_items_select_public" on public.menu_items;
create policy "menu_items_select_public"      on public.menu_items      for select to anon, authenticated using (true);
drop policy if exists "combo_offers_select_public" on public.combo_offers;
create policy "combo_offers_select_public"    on public.combo_offers    for select to anon, authenticated using (true);

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

-- ============================================================================
-- 6. sla_tiers (internal reference table)
-- ============================================================================
grant select on public.sla_tiers to authenticated;
grant insert, update, delete on public.sla_tiers to authenticated; -- narrowed by policy

drop policy if exists "sla_tiers_select_authenticated" on public.sla_tiers;
create policy "sla_tiers_select_authenticated"
  on public.sla_tiers for select to authenticated using (true);

drop policy if exists "sla_tiers_write_general_manager" on public.sla_tiers;
create policy "sla_tiers_write_general_manager"
  on public.sla_tiers for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

-- ============================================================================
-- 7. orders
-- Visibility mirrors the branch/region isolation rule in section 3.
-- No client UPDATE policy: all transitions go through edge functions.
-- ============================================================================
grant select, insert on public.orders to authenticated;

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

drop policy if exists "orders_select_customer" on public.orders;
create policy "orders_select_customer"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'customer'
    and customer_id = auth.uid()
  );

-- Customer places their own order directly from the customer app.
drop policy if exists "orders_insert_customer" on public.orders;
create policy "orders_insert_customer"
  on public.orders for insert to authenticated
  with check (
    current_user_role()::text = 'customer'
    and customer_id = auth.uid()
    and order_source = 'customer_app'
    and status = 'pending_acceptance'
  );

-- Call center / team_leader / general_manager can log an order on a
-- customer's behalf (phone order). POS-origin rows ('pos' source) are only
-- ever inserted by the POS integration using the service_role key, which
-- bypasses RLS entirely - client roles cannot claim order_source = 'pos'.
drop policy if exists "orders_insert_call_center" on public.orders;
create policy "orders_insert_call_center"
  on public.orders for insert to authenticated
  with check (
    current_user_role()::text in ('call_center', 'general_manager', 'team_leader')
    and order_source = 'call_center'
    and status = 'pending_acceptance'
  );

-- ============================================================================
-- 8. order_items (visibility follows the parent order)
-- ============================================================================
grant select, insert on public.order_items to authenticated;

drop policy if exists "order_items_select_via_order" on public.order_items;
create policy "order_items_select_via_order"
  on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));
  -- orders RLS already restricts which rows the exists-subquery can see,
  -- so this effectively inherits the parent order's visibility.

drop policy if exists "order_items_insert_via_order" on public.order_items;
create policy "order_items_insert_via_order"
  on public.order_items for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_items.order_id));
  -- same idea: the caller must be able to see (and therefore have just
  -- inserted, per the orders insert policies above) the parent order.

-- ============================================================================
-- 9. otp_codes - locked down entirely. Only edge functions (service_role)
-- generate, read, and verify codes. No SELECT/INSERT/UPDATE policy is
-- granted to any client role on purpose.
-- ============================================================================
-- (no grants to anon/authenticated - table is invisible to clients)

-- ============================================================================
-- 10. complaints
-- ============================================================================
grant select, insert, update on public.complaints to authenticated;

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

drop policy if exists "complaints_select_customer" on public.complaints;
create policy "complaints_select_customer"
  on public.complaints for select to authenticated
  using (
    current_user_role()::text = 'customer'
    and exists (select 1 from public.orders o where o.id = complaints.order_id and o.customer_id = auth.uid())
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

drop policy if exists "complaints_insert_customer" on public.complaints;
create policy "complaints_insert_customer"
  on public.complaints for insert to authenticated
  with check (
    current_user_role()::text = 'customer'
    and exists (select 1 from public.orders o where o.id = complaints.order_id and o.customer_id = auth.uid())
  );

-- Driver app exception buttons (section 5): "customer not found" / OTP
-- lockout both log a complaint against the driver's own assigned order.
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

-- Snapshot branch_id/driver_id from the order at insert time so they can't
-- be spoofed by the client and always match the order they're filed against.
create or replace function public.set_complaint_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select o.branch_id, o.driver_id into new.branch_id, new.driver_id
  from public.orders o where o.id = new.order_id;
  return new;
end;
$$;

drop trigger if exists trg_set_complaint_snapshot on public.complaints;
create trigger trg_set_complaint_snapshot
  before insert on public.complaints
  for each row execute function public.set_complaint_snapshot();
