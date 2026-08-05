-- Two additions for customer-web: self-service order cancellation (with a
-- required reason, staff-visible) and a post-delivery rating.

alter table public.orders
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_by uuid references public.users(id);

create table if not exists public.order_ratings (
  id bigint generated always as identity primary key,
  order_id int not null unique references public.orders(id) on delete cascade,
  customer_id uuid not null references public.users(id),
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table public.order_ratings enable row level security;

grant select, insert on public.order_ratings to authenticated;

-- Customer can only rate their own delivered orders, and only once (the
-- unique constraint on order_id enforces "once"; the with-check enforces
-- "own order, and it actually delivered" so a rating can't be filed for
-- an order still in progress or someone else's).
drop policy if exists "order_ratings_insert_customer" on public.order_ratings;
create policy "order_ratings_insert_customer"
  on public.order_ratings for insert to authenticated
  with check (
    current_user_role()::text = 'customer'
    and customer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_ratings.order_id
        and o.customer_id = auth.uid()
        and o.status = 'delivered'
    )
  );

drop policy if exists "order_ratings_select_customer" on public.order_ratings;
create policy "order_ratings_select_customer"
  on public.order_ratings for select to authenticated
  using (current_user_role()::text = 'customer' and customer_id = auth.uid());

-- Staff visibility mirrors the same three-tier scoping used everywhere
-- else in this project (general_manager sees all, regional_manager their
-- region's branches, branch_manager their own branch) - joins through the
-- parent order to find its branch.
drop policy if exists "order_ratings_select_staff" on public.order_ratings;
create policy "order_ratings_select_staff"
  on public.order_ratings for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_ratings.order_id
        and (
          current_user_role()::text in ('general_manager', 'team_leader')
          or (current_user_role()::text = 'regional_manager' and o.branch_id in (select public.current_user_region_branch_ids()))
          or (current_user_role()::text = 'branch_manager' and o.branch_id = current_user_branch_id())
        )
    )
  );
