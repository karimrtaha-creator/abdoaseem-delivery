-- Menu restructuring per owner's exact instructions, plus two new
-- capabilities: a per-order-line customer note, and a configurable
-- ordering-hours window enforced by create-order.

-- Remove items already dead-listed (is_available=false) or explicitly
-- retired, and the combined "عدس/تقلية" item that's being split in two.
delete from public.menu_items where id in (17, 19, 27, 26);

-- New standalone extras replacing the combined item above.
insert into public.menu_items (category_id, name, price, is_available)
values
  (5, 'عدس', 12.00, true),
  (5, 'تقلية', 12.00, true);

-- Two new categories: وجبات (for وجبة عالم سمسم, split out of الكشري) and
-- الميكسات (for the مكس items, split out of الطواجن).
insert into public.menu_categories (name, display_order)
values
  ('وجبات', 2),
  ('الميكسات', 4);

-- Renumber the existing categories so the final order is:
-- الكشري -> وجبات -> الطواجن -> الميكسات -> الحلو -> المشروبات -> اضافات
update public.menu_categories set display_order = 1 where name = 'الكشري';
update public.menu_categories set display_order = 3 where name = 'الطواجن';
update public.menu_categories set display_order = 5 where name = 'الحلو';
update public.menu_categories set display_order = 6 where name = 'المشروبات';
update public.menu_categories set display_order = 7 where name = 'اضافات';

-- Move وجبة عالم سمسم into وجبات, and the مكس items into الميكسات.
update public.menu_items set category_id = (select id from public.menu_categories where name = 'وجبات')
  where id = 5;
update public.menu_items set category_id = (select id from public.menu_categories where name = 'الميكسات')
  where id in (12, 13, 14, 15);

-- Mozzarella becomes 3 standalone tagine items instead of a bolt-on extra.
-- menu_item_extra_applicability rows for id 23 cascade-delete automatically
-- (confirmed FK: extra_item_id ... on delete cascade).
delete from public.menu_items where id = 23;

insert into public.menu_items (category_id, name, price, is_available)
values
  (2, 'طاجن فراخ موتزريلا', 90.00, true),
  (2, 'طاجن لحمة موتزريلا', 85.00, true),
  (2, 'طاجن خضار موتزريلا', 65.00, true);

-- Per-order-line customer note ("من غير تقلية" etc.) - free text, never
-- interpreted server-side beyond a length cap in create-order.
alter table public.order_items add column if not exists note text;

-- Configurable ordering-hours window, single global row. Public read so
-- customer-web can show a banner; write restricted to general_manager and
-- team_leader (the only two roles the owner wants able to change it).
create table if not exists public.business_hours (
  id smallint primary key default 1 check (id = 1),
  opens_at time not null default '08:00',
  closes_at time not null default '03:00',
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

insert into public.business_hours (id) values (1) on conflict (id) do nothing;

alter table public.business_hours enable row level security;
grant select on public.business_hours to anon, authenticated;
grant update on public.business_hours to authenticated;

drop policy if exists "business_hours_select_public" on public.business_hours;
create policy "business_hours_select_public"
  on public.business_hours for select
  to anon, authenticated
  using (true);

drop policy if exists "business_hours_update_managers" on public.business_hours;
create policy "business_hours_update_managers"
  on public.business_hours for update
  to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader') and current_user_is_active())
  with check (current_user_role()::text in ('general_manager', 'team_leader') and current_user_is_active());
