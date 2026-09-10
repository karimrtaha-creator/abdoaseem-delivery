-- "اصنع وجبتك بنفسك" (Karim, 2026-09-10): a new homepage feature where the
-- customer picks a product type (كشري/طاجن), a box size (fixed price + a
-- gram budget), fills the box themselves from real menu_items up to that
-- budget at no extra charge, then sees type-specific paid extras.
--
-- combo_choice_groups/combo_choice_options (0016) can't express this: they
-- only support exactly-one-choice-per-group, and options are plain text
-- labels, not FKs into menu_items ("'2 ماكسي كولا' isn't a real standalone
-- product ... choice options are plain descriptive labels" - 0016's own
-- comment). This needs a real "freely distribute a gram budget across many
-- real menu_items" model, which is what the three tables below give it,
-- while still pricing everything off real menu_items rows (never a new
-- parallel catalog).

alter table public.menu_categories add column if not exists is_buildable_box boolean not null default false;

create table if not exists public.box_sizes (
  id bigint generated always as identity primary key,
  category_id int not null references public.menu_categories(id) on delete cascade,
  name text not null,               -- "صغيرة" / "وسط" / "كبيرة"
  price numeric not null,
  capacity_grams int not null,
  display_order int not null default 0,
  is_available boolean not null default true
);

-- Which existing menu_items can fill a box of this category, and how many
-- grams one unit of it consumes from the chosen size's capacity_grams -
-- free to add as long as the running total stays within budget.
create table if not exists public.box_fill_components (
  id bigint generated always as identity primary key,
  category_id int not null references public.menu_categories(id) on delete cascade,
  menu_item_id bigint not null references public.menu_items(id) on delete cascade,
  grams_per_unit int not null,
  display_order int not null default 0,
  is_available boolean not null default true,
  unique (category_id, menu_item_id)
);

-- Which existing menu_items are suggested as PAID additions once a box of
-- this category is being built (extra chicken, mozzarella, etc.) - always
-- priced at the item's own menu_items.price, never counted against the
-- size's gram budget.
create table if not exists public.box_extra_suggestions (
  id bigint generated always as identity primary key,
  category_id int not null references public.menu_categories(id) on delete cascade,
  menu_item_id bigint not null references public.menu_items(id) on delete cascade,
  display_order int not null default 0,
  is_available boolean not null default true,
  unique (category_id, menu_item_id)
);

alter table public.order_items add column if not exists box_size_id bigint references public.box_sizes(id);

alter table public.box_sizes enable row level security;
alter table public.box_fill_components enable row level security;
alter table public.box_extra_suggestions enable row level security;

grant select on public.box_sizes, public.box_fill_components, public.box_extra_suggestions to anon, authenticated;
grant insert, update, delete on public.box_sizes, public.box_fill_components, public.box_extra_suggestions to authenticated;

drop policy if exists "box_sizes_select_public" on public.box_sizes;
create policy "box_sizes_select_public" on public.box_sizes for select to anon, authenticated using (true);
drop policy if exists "box_sizes_write_general_manager" on public.box_sizes;
create policy "box_sizes_write_general_manager"
  on public.box_sizes for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "box_fill_components_select_public" on public.box_fill_components;
create policy "box_fill_components_select_public" on public.box_fill_components for select to anon, authenticated using (true);
drop policy if exists "box_fill_components_write_general_manager" on public.box_fill_components;
create policy "box_fill_components_write_general_manager"
  on public.box_fill_components for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "box_extra_suggestions_select_public" on public.box_extra_suggestions;
create policy "box_extra_suggestions_select_public" on public.box_extra_suggestions for select to anon, authenticated using (true);
drop policy if exists "box_extra_suggestions_write_general_manager" on public.box_extra_suggestions;
create policy "box_extra_suggestions_write_general_manager"
  on public.box_extra_suggestions for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

-- create_order_with_items (0056, extended by 0066 for vouchers) - same
-- signature, just teaches the order_items insert about the new box_size_id
-- column so create-order (which now resolves+validates box order lines
-- itself, never trusting client-sent grams/prices) can persist them.
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

  insert into public.order_items (order_id, menu_item_id, combo_offer_id, box_size_id, quantity, unit_price, combo_selection, note)
  select
    v_order_id,
    (item->>'menu_item_id')::bigint,
    (item->>'combo_offer_id')::bigint,
    (item->>'box_size_id')::bigint,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric,
    item->>'combo_selection',
    item->>'note'
  from jsonb_array_elements(p_items) as item;

  return v_order_id;
end;
$$;
