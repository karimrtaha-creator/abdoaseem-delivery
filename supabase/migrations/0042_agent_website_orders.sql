-- "Agent" role redefinition (2026-08-11, Karim's explicit instruction):
-- call_center (displayed as "Agent" in the UI - the enum value itself is
-- unchanged, only the label) keeps its existing phone-order duty
-- (CallCenter.tsx, order_source='call_center') and additionally gains
-- visibility into website orders (order_source='customer_app') so they
-- can accept/reject/follow up on them - purely additive, nothing removed
-- from the existing phone-order flow.
drop policy if exists "orders_select_call_center" on public.orders;
create policy "orders_select_call_center"
  on public.orders for select to authenticated
  using (
    current_user_role()::text = 'call_center'
    and public.current_user_is_active()
    and order_source in ('call_center', 'customer_app')
  );
