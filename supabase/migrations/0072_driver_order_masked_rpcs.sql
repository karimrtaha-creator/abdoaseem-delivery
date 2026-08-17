-- Driver app redesign, part 2: masked read RPCs so customer_phone is never
-- returned to the driver_app until driver_received_at is set - the actual
-- data-gating Karim asked for ("لا تعتمد على إخفاء البيانات من الشاشة"),
-- not a client-side "just don't show this field" choice. The base
-- orders_select_driver RLS policy (0038) stays exactly as-is and keeps
-- backing the Realtime subscription driver_app uses for instant "new
-- order" updates - Realtime requires a base-table SELECT policy to know
-- which rows a subscriber may see at all, and Postgres Realtime always
-- broadcasts the full row for any change a subscriber's RLS allows (it has
-- no column-level masking of its own). driver_app is being changed
-- alongside this migration to only use the realtime stream as a "something
-- changed, refetch" signal, and to always read actual displayable data
-- (customer_phone included) through these two functions instead of the
-- raw stream payload - see driver_app's orders_service.dart. The one
-- residual gap this can't close: a driver's own raw Realtime socket frame
-- for their own already-assigned order still technically carries
-- customer_phone at the protocol level even before receipt - documented
-- as a known, low-impact limitation (the same driver is already the
-- authorized RLS-scoped reader of that row, just moments earlier than the
-- intended flow) rather than silently claimed as fully closed.
create or replace function public.list_my_driver_orders()
returns table (
  id bigint,
  pos_order_id text,
  customer_id uuid,
  address_id bigint,
  customer_phone text,
  status text,
  dispatch_time timestamptz,
  sla_minutes int,
  delivered_time timestamptz,
  delay_minutes int,
  is_delayed boolean,
  driver_received_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.id, o.pos_order_id, o.customer_id, o.address_id,
    case when o.driver_received_at is not null then o.customer_phone else null end,
    o.status::text, o.dispatch_time, o.sla_minutes, o.delivered_time, o.delay_minutes, o.is_delayed,
    o.driver_received_at
  from public.orders o
  where o.driver_id = auth.uid()
    and current_user_role()::text = 'driver'
    and current_user_is_active()
    and o.status in ('out_for_delivery', 'delayed');
$$;

create or replace function public.get_my_driver_order(p_order_id bigint)
returns table (
  id bigint,
  pos_order_id text,
  customer_id uuid,
  address_id bigint,
  customer_phone text,
  status text,
  dispatch_time timestamptz,
  sla_minutes int,
  delivered_time timestamptz,
  delay_minutes int,
  is_delayed boolean,
  driver_received_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.id, o.pos_order_id, o.customer_id, o.address_id,
    case when o.driver_received_at is not null then o.customer_phone else null end,
    o.status::text, o.dispatch_time, o.sla_minutes, o.delivered_time, o.delay_minutes, o.is_delayed,
    o.driver_received_at
  from public.orders o
  where o.id = p_order_id
    and o.driver_id = auth.uid()
    and current_user_role()::text = 'driver'
    and current_user_is_active();
$$;

revoke all on function public.list_my_driver_orders() from public;
revoke all on function public.get_my_driver_order(bigint) from public;
grant execute on function public.list_my_driver_orders() to authenticated;
grant execute on function public.get_my_driver_order(bigint) to authenticated;
