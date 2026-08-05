-- CRITICAL FIX: orders/order_items had client-facing INSERT grants whose
-- RLS policies only checked ownership/role/status flags - never price,
-- address ownership, branch-delivery-eligibility, or business hours. That
-- meant any signed-up customer could bypass create-order entirely and
-- POST directly to PostgREST:
--   1. insert into orders with any branch_id/address_id (no ownership
--      check, no delivery-availability check, no business-hours check)
--   2. insert into order_items with any unit_price at all (never
--      re-validated against menu_items.price)
-- Confirmed live and exploitable during audit: inserted 5x a 115ج item at
-- unit_price=0.01 and it succeeded. This is the same class of gap the
-- existing "no client UPDATE policy on orders" design already closed for
-- status transitions (see 0001's design notes) - INSERT was the one place
-- that principle wasn't followed.
--
-- Fix: revoke the client INSERT grants entirely. All order creation goes
-- exclusively through the create-order edge function already (confirmed:
-- no other code path in either app inserts into orders/order_items
-- directly), which uses the service_role key and re-validates every price,
-- address ownership, branch eligibility, and the business-hours window
-- server-side. This makes direct-table order creation impossible for any
-- client role, matching the same "edge function only" pattern already used
-- for otp_codes and for every order status transition.

revoke insert on public.orders from authenticated;
revoke insert on public.order_items from authenticated;

-- The INSERT policies become dead code once the grant is gone, but drop
-- them too so nothing here is misleading about what's actually reachable.
drop policy if exists "orders_insert_customer" on public.orders;
drop policy if exists "orders_insert_call_center" on public.orders;
drop policy if exists "order_items_insert_via_order" on public.order_items;
