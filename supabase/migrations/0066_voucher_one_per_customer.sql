-- Karim: max_uses is a shared pool across every customer, but the same
-- customer must never be able to redeem the same code twice (across
-- separate orders), regardless of how much of the pool is left. No new
-- table needed - orders already records customer_id + voucher_code per
-- redemption (0064), so "has this customer used this code before" is just
-- a lookup against that.
create or replace function public.check_voucher(p_code text, p_subtotal numeric)
returns table(valid boolean, discount_amount numeric, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher record;
  v_discount numeric;
  v_already_used boolean;
begin
  select * into v_voucher from public.vouchers where code = upper(trim(p_code));

  if v_voucher is null then
    return query select false, 0::numeric, 'الكود ده مش موجود';
    return;
  end if;
  if not v_voucher.is_active then
    return query select false, 0::numeric, 'الكود ده مش شغال دلوقتي';
    return;
  end if;
  if v_voucher.expires_at is not null and v_voucher.expires_at < now() then
    return query select false, 0::numeric, 'الكود ده منتهي الصلاحية';
    return;
  end if;
  if v_voucher.max_uses is not null and v_voucher.used_count >= v_voucher.max_uses then
    return query select false, 0::numeric, 'الكود ده خلص استخدامه';
    return;
  end if;
  if v_voucher.min_order_value is not null and p_subtotal < v_voucher.min_order_value then
    return query select false, 0::numeric, format('الكود ده يشتغل من %s ج فأكتر', v_voucher.min_order_value);
    return;
  end if;

  -- auth.uid() here, never a client-supplied id - this function is called
  -- directly by the customer's own session (unlike create_order_with_items
  -- below, which only ever runs behind the edge function's already-
  -- authenticated caller resolution).
  if auth.uid() is not null then
    select exists(
      select 1 from public.orders where customer_id = auth.uid() and voucher_code = upper(trim(p_code))
    ) into v_already_used;
    if v_already_used then
      return query select false, 0::numeric, 'انت استخدمت الكود ده قبل كده';
      return;
    end if;
  end if;

  if v_voucher.discount_type = 'percentage' then
    v_discount := round(p_subtotal * v_voucher.discount_value / 100, 2);
  else
    v_discount := least(v_voucher.discount_value, p_subtotal);
  end if;

  return query select true, v_discount, null::text;
end;
$$;

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
  p_items jsonb,
  p_voucher_code text default null,
  p_subtotal numeric default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id bigint;
  v_voucher record;
  v_discount numeric := 0;
  v_already_used boolean;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty JSON array';
  end if;

  if p_voucher_code is not null then
    select * into v_voucher from public.vouchers where code = upper(trim(p_voucher_code)) for update;

    if v_voucher is null then
      raise exception 'voucher code not found';
    end if;
    if not v_voucher.is_active then
      raise exception 'voucher code is not active';
    end if;
    if v_voucher.expires_at is not null and v_voucher.expires_at < now() then
      raise exception 'voucher code has expired';
    end if;
    if v_voucher.max_uses is not null and v_voucher.used_count >= v_voucher.max_uses then
      raise exception 'voucher code has no uses remaining';
    end if;
    if v_voucher.min_order_value is not null and coalesce(p_subtotal, 0) < v_voucher.min_order_value then
      raise exception 'voucher code requires a minimum order value of %', v_voucher.min_order_value;
    end if;

    select exists(
      select 1 from public.orders where customer_id = p_customer_id and voucher_code = upper(trim(p_voucher_code))
    ) into v_already_used;
    if v_already_used then
      raise exception 'voucher code already used by this customer';
    end if;

    if v_voucher.discount_type = 'percentage' then
      v_discount := round(coalesce(p_subtotal, 0) * v_voucher.discount_value / 100, 2);
    else
      v_discount := least(v_voucher.discount_value, coalesce(p_subtotal, 0));
    end if;

    update public.vouchers set used_count = used_count + 1 where id = v_voucher.id;
  end if;

  insert into public.orders (
    order_source, branch_id, customer_id, customer_phone, address_id,
    status, order_time, payment_method, payment_proof_url,
    delivery_fee_after_tax, delivery_service, delivery_time_minutes,
    voucher_code, discount_amount
  ) values (
    p_order_source::order_source_type, p_branch_id, p_customer_id, p_customer_phone, p_address_id,
    'pending_acceptance', now(), p_payment_method::payment_method_type, p_payment_proof_url,
    p_delivery_fee, p_delivery_service, p_delivery_time_minutes,
    case when p_voucher_code is not null then upper(trim(p_voucher_code)) else null end, v_discount
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
