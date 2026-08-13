-- Karim's correction (2026-08-11, same night): Agent (call_center role)
-- won't use the phone-order screen at all anymore - website orders only,
-- full stop. Narrows migration 0042 back down: remove call_center-sourced
-- orders from what this role can see at all, since there's no longer any
-- reason for them to (can't create them via this UI anymore, was never
-- able to accept them either). CallCenter.tsx itself and the
-- order_source='call_center' concept are untouched in case they're
-- needed by a different role later - only this role's own scope narrows.
drop policy if exists "orders_select_call_center" on public.orders;
create policy "orders_select_call_center"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'call_center'
    and public.current_user_is_active()
    and order_source = 'customer_app'
  );
