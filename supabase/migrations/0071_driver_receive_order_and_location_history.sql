-- Driver app redesign, part 1 (backend): adds a real "driver received this
-- order" step that didn't exist before - dispatch-order previously set
-- driver_id AND status='out_for_delivery' in one atomic move, with nothing
-- in between. driver_received_at is the new gate customer PII visibility
-- and delivery confirmation both key off (see receive-order function and
-- confirm-delivery's tightened guard, both added alongside this migration).
alter table public.orders add column driver_received_at timestamptz;

-- Karim wants a log of which drivers correct a customer's saved location,
-- visible to general_manager - and separately, saveAddressLocation's plain
-- overwrite (0005) never kept history, which the new "الموقع غلط" flow
-- needs. One append-only table serves both: every real lat/lng change
-- gets archived here automatically via trigger, so no driver_app code
-- change is required to populate it - the existing direct
-- UPDATE customer_addresses call already sets location_saved_by (the
-- driver's own id), which the trigger reads.
create table public.customer_address_location_history (
  id bigint generated always as identity primary key,
  address_id bigint not null references public.customer_addresses(id) on delete cascade,
  order_id bigint references public.orders(id) on delete set null,
  driver_id uuid references public.users(id),
  old_latitude double precision,
  old_longitude double precision,
  new_latitude double precision,
  new_longitude double precision,
  changed_at timestamptz not null default now()
);

-- SECURITY DEFINER because the driver role that triggers this (via a plain
-- authenticated UPDATE on customer_addresses) has no reason to ever hold a
-- direct INSERT grant on the history table itself - same "the trigger can
-- do more than the invoking role could on its own" pattern already used by
-- prevent_driver_address_field_tamper() (0005) and current_user_role() in
-- this schema.
create or replace function public.log_customer_address_location_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude then
    insert into public.customer_address_location_history
      (address_id, order_id, driver_id, old_latitude, old_longitude, new_latitude, new_longitude)
    values (
      new.id,
      (
        select o.id from public.orders o
        where o.address_id = new.id
          and o.driver_id = new.location_saved_by
          and o.status in ('out_for_delivery', 'delayed')
        order by o.dispatch_time desc nulls last
        limit 1
      ),
      new.location_saved_by,
      old.latitude, old.longitude,
      new.latitude, new.longitude
    );
  end if;
  return new;
end;
$$;

drop trigger if exists customer_address_location_history_trigger on public.customer_addresses;
create trigger customer_address_location_history_trigger
  after update on public.customer_addresses
  for each row
  execute function public.log_customer_address_location_change();

alter table public.customer_address_location_history enable row level security;
grant select on public.customer_address_location_history to authenticated;

create policy "customer_address_location_history_select_gm"
  on public.customer_address_location_history for select
  to authenticated
  using (current_user_role()::text = 'general_manager' and current_user_is_active());

-- Narrows both driver policies on customer_addresses (0005/0006) from "any
-- order this driver was EVER assigned, any status" to "an order they're
-- currently, actively delivering" - Karim confirmed this is intended: a
-- driver who delivered an order weeks ago has no ongoing reason to still
-- be able to read or edit that customer's address.
drop policy if exists "customer_addresses_select_driver_current_order" on public.customer_addresses;
create policy "customer_addresses_select_driver_current_order"
  on public.customer_addresses for select
  to authenticated
  using (
    current_user_role()::text = 'driver'
    and public.current_user_is_active()
    and exists (
      select 1 from public.orders o
      where o.address_id = customer_addresses.id
        and o.driver_id = auth.uid()
        and o.status in ('out_for_delivery', 'delayed')
    )
  );

drop policy if exists "customer_addresses_update_driver_current_order" on public.customer_addresses;
create policy "customer_addresses_update_driver_current_order"
  on public.customer_addresses for update
  to authenticated
  using (
    current_user_role()::text = 'driver'
    and public.current_user_is_active()
    and exists (
      select 1 from public.orders o
      where o.address_id = customer_addresses.id
        and o.driver_id = auth.uid()
        and o.status in ('out_for_delivery', 'delayed')
    )
  )
  with check (
    current_user_role()::text = 'driver'
    and public.current_user_is_active()
    and exists (
      select 1 from public.orders o
      where o.address_id = customer_addresses.id
        and o.driver_id = auth.uid()
        and o.status in ('out_for_delivery', 'delayed')
    )
  );
