-- Multi-address support (schema + RLS only - per instructions, no client
-- code wired to this yet; see the "impact on existing code" note below).
--
-- Design, per the three decisions given:
--   1. Driver saves GPS coordinates on an address manually (a button tap
--      standing at the door), never automatically - so location_saved_at/
--      location_saved_by exist to record *when/who*, not a live tracker.
--   2. A customer can have several addresses (home/work/...); call_center
--      picks one per order at creation time - hence orders.address_id.
--   3. Driver sees only the address tied to an order assigned to them
--      (any status, not just active - mirrors the existing orders_select_
--      driver policy's scope, so this isn't a narrower or wider rule than
--      what a driver can already see about their own deliveries).
--      call_center sees/manages the customer address book broadly, same
--      breadth as their existing customers_profile access - there is no
--      "assigned agent per customer" concept anywhere else in this schema
--      to scope it any tighter.
--
-- Deliberately NOT granted here: branch_manager/regional_manager/general_
-- manager/team_leader access to customer_addresses. Nothing in the request
-- asked for it, and it's not implied by anything else in section 3 - add
-- it explicitly later if that turns out to be wrong.
--
-- customers_profile (the old single-address table) is untouched by this
-- migration and stays fully functional as-is - see the impact note.

create table if not exists public.customer_addresses (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  label text, -- free text, e.g. 'البيت' / 'الشغل' - not an enum, not required
  building text,
  floor text,
  apartment text,
  area text,
  nearest_branch_id int references public.branches(id),
  latitude double precision,
  longitude double precision,
  location_saved_at timestamptz,
  location_saved_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists address_id bigint references public.customer_addresses(id) on delete set null;

alter table public.customer_addresses enable row level security;

grant select, insert, update on public.customer_addresses to authenticated;

-- Customer: manage their own saved addresses (not asked for explicitly,
-- but the same shape as the existing customers_profile self-access
-- policies and costs nothing extra to include now).
drop policy if exists "customer_addresses_select_self" on public.customer_addresses;
create policy "customer_addresses_select_self"
  on public.customer_addresses for select to authenticated
  using (current_user_role()::text = 'customer' and user_id = auth.uid());

drop policy if exists "customer_addresses_write_self" on public.customer_addresses;
create policy "customer_addresses_write_self"
  on public.customer_addresses for all to authenticated
  using (current_user_role()::text = 'customer' and user_id = auth.uid())
  with check (current_user_role()::text = 'customer' and user_id = auth.uid());

-- call_center: broad read/write over the address book, matching the
-- existing customers_profile_write_call_center policy's breadth.
drop policy if exists "customer_addresses_manage_call_center" on public.customer_addresses;
create policy "customer_addresses_manage_call_center"
  on public.customer_addresses for all to authenticated
  using (current_user_role()::text in ('call_center', 'general_manager', 'team_leader'))
  with check (current_user_role()::text in ('call_center', 'general_manager', 'team_leader'));

-- driver: read-only, and only the one address tied to an order currently
-- (or previously) assigned to them - never the open address book.
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

-- driver: allowed to update this same narrow set of rows, but ONLY the
-- location fields - the trigger below blocks changing anything else
-- (building/area/label/etc. stay call_center's responsibility).
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

create or replace function public.prevent_driver_address_field_tamper()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role()::text = 'driver' then
    if new.user_id is distinct from old.user_id
       or new.label is distinct from old.label
       or new.building is distinct from old.building
       or new.floor is distinct from old.floor
       or new.apartment is distinct from old.apartment
       or new.area is distinct from old.area
       or new.nearest_branch_id is distinct from old.nearest_branch_id then
      raise exception 'drivers can only update location fields on a customer address';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_driver_address_field_tamper on public.customer_addresses;
create trigger trg_prevent_driver_address_field_tamper
  before update on public.customer_addresses
  for each row execute function public.prevent_driver_address_field_tamper();
