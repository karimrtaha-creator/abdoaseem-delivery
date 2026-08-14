-- Security audit finding F-01 (Batch 3, 2026-08-14): create-order's
-- finishOrder() used two separate, non-transactional supabase-js calls -
-- INSERT INTO orders (commits on its own), then INSERT INTO order_items
-- using the new order's id. If the second insert failed for any reason,
-- the first one's row stayed committed: a real orders row with zero
-- order_items ("order created (id=X) but items failed" was literally the
-- error message this returned). Originally reproduced via malformed
-- quantity (1.5, 1e308) - closed for that specific input by M-02's
-- stricter validation (Batch 2), but the underlying non-atomicity was
-- architectural, not tied to that one input shape: any other late
-- failure between the two inserts (a constraint violation, a transient
-- error, an edge case not yet found) could orphan an order the same way.
--
-- Fixed the same way check_rate_limit (0032) and record_otp_wrong_attempt
-- (0052) already fix a different class of bug in this project: instead of
-- multiple client-driven statements, one SECURITY DEFINER function does
-- both inserts. A single function invocation runs inside one implicit
-- transaction - if anything inside raises (a constraint violation, a bad
-- cast), Postgres rolls back everything the function did, including the
-- orders row already inserted earlier in the same call. Called once via
-- admin.rpc(), which is one PostgREST request = one transaction, so this
-- gives real database-enforced atomicity with no new moving parts.
--
-- All business validation (menu item / combo existence & availability,
-- combo choice matching, quantity bounds, price lookup) still happens in
-- the edge function BEFORE this is called, exactly as before - this
-- function only re-expresses "insert the order, then insert its items"
-- as one atomic unit; it is not a second validation layer.
create or replace function public.create_order_with_items(
  p_order_source text,
  p_branch_id bigint,
  p_customer_id uuid,
  p_customer_phone text,
  p_address_id bigint,
  p_payment_method text,
  p_payment_proof_url text,
  p_delivery_fee numeric,
  p_delivery_service text,
  p_delivery_time_minutes int,
  p_items jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty JSON array';
  end if;

  insert into public.orders (
    order_source, branch_id, customer_id, customer_phone, address_id,
    status, order_time, payment_method, payment_proof_url,
    delivery_fee_after_tax, delivery_service, delivery_time_minutes
  ) values (
    p_order_source::order_source_type, p_branch_id, p_customer_id, p_customer_phone, p_address_id,
    'pending_acceptance', now(), p_payment_method::payment_method_type, p_payment_proof_url,
    p_delivery_fee, p_delivery_service, p_delivery_time_minutes
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, menu_item_id, combo_offer_id, quantity, unit_price, combo_selection, note)
  select
    v_order_id,
    (item->>'menu_item_id')::bigint,
    (item->>'combo_offer_id')::bigint,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric,
    item->>'combo_selection',
    item->>'note'
  from jsonb_array_elements(p_items) as item;

  return v_order_id;
end;
$$;

-- service_role only, same posture as check_rate_limit/record_otp_wrong_attempt
-- after 0050: already has EXECUTE via 0004's blanket grant + default-
-- privileges rule, no anon/authenticated grant added since only the
-- create-order edge function's admin client ever calls this.
