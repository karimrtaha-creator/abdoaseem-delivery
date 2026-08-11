-- Mandatory dispatcher-photo gate, part 2. Extensible (not one column) per
-- Karim's explicit instruction - multiple photos per order allowed, no
-- unique constraint on order_id.
create table public.order_photos (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  dispatcher_id uuid not null references public.users(id),
  photo_url text not null,
  photographed_at timestamptz not null default now()
);
create index idx_order_photos_order_id on public.order_photos (order_id);

alter table public.order_photos enable row level security;

create policy "order_photos_service_role"
  on public.order_photos for all to service_role using (true) with check (true);

-- Staff see photos scoped exactly like they already see the parent order -
-- same EXISTS-via-parent pattern already used by order_items_select_via_order
-- and the complaints policies (confirmed live during the earlier index
-- analysis), so this doesn't duplicate branch/region scoping logic here.
create policy "order_photos_select_staff"
  on public.order_photos for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_photos.order_id));

-- Karim's explicit hardening request: don't rely on driver_id alone (a
-- future bug in whatever sets driver_id could bypass the photo gate) -
-- the driver's own RLS policy independently re-checks that a real photo
-- row exists for the order, not just that they're the assigned driver.
drop policy if exists "orders_select_driver" on public.orders;
create policy "orders_select_driver"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'driver'
    and public.current_user_is_active()
    and driver_id = auth.uid()
    and exists (select 1 from public.order_photos p where p.order_id = orders.id)
  );

-- A staff-cancellable order can now legitimately be sitting in
-- 'ready_for_driver' (photographed, not yet assigned a driver) - without
-- this it'd be stuck, cancellable neither as 'preparing' nor via any other
-- status in the existing list.
comment on type public.order_status is 'ready_for_driver added 2026-08-11: photographed by dispatcher, not yet assigned a driver. cancel-order''s STAFF_CANCELLABLE_STATUSES must include it (enforced in application code, not here).';
