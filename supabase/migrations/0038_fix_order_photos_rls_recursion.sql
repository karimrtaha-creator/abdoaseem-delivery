-- Bug found during live verification of migration 0037: orders_select_driver
-- (checks order_photos exists) and order_photos_select_staff (checks the
-- parent order exists, via a plain EXISTS against orders) reference each
-- other's RLS-protected table directly - Postgres has to evaluate each
-- policy to evaluate the other, which is exactly the infinite-recursion
-- case (confirmed live: "infinite recursion detected in policy for
-- relation 'orders'"). Same fix pattern this project already uses for
-- current_user_branch_id()/current_user_role()/etc: a SECURITY DEFINER
-- function, owned the same way those already are, so it bypasses RLS on
-- the table it checks internally (table-owner bypass) instead of
-- re-triggering that table's own policies.
create or replace function public.order_has_photo(p_order_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.order_photos where order_id = p_order_id);
$$;

drop policy if exists "orders_select_driver" on public.orders;
create policy "orders_select_driver"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'driver'
    and public.current_user_is_active()
    and driver_id = auth.uid()
    and public.order_has_photo(orders.id)
  );
