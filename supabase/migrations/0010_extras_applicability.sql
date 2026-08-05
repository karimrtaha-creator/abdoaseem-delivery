-- Restricts which extras apply to which base items. Exception-based, same
-- shape as 0009's branch closures: an extra with ZERO rows here is
-- unrestricted (current behaviour, unchanged for every existing extra
-- except mozzarella) - an extra with rows here is only offerable alongside
-- one of the listed base items.
--
-- Immediate use case (Karim's request): "إضافة موتزريلا للطاجن" (item 23)
-- should only be addable with a *regular* tagine - طاجن فراخ / طاجن لحم /
-- طاجن خضار (items 6, 8, 10) - not the جامبو variants and not the مكس
-- items. Assumption flagged to Karim: "الطواجن الوسط" = the regular-size
-- tagines, not جامبو; correct via a follow-up migration if wrong, this one
-- doesn't need to change shape, just the seed rows.
--
-- Enforcement itself is client-side in customer-web (Menu.tsx gates the
-- add-to-cart button using the flat CartLine list, since there's no
-- per-line "parent item" concept yet) - this table is the source of truth
-- both the admin screen and the customer UI read from.

create table if not exists public.menu_item_extra_applicability (
  id bigint generated always as identity primary key,
  extra_item_id bigint not null references public.menu_items(id) on delete cascade,
  applies_to_item_id bigint not null references public.menu_items(id) on delete cascade,
  unique (extra_item_id, applies_to_item_id)
);

alter table public.menu_item_extra_applicability enable row level security;

grant select on public.menu_item_extra_applicability to anon, authenticated;
grant insert, update, delete on public.menu_item_extra_applicability to authenticated;

drop policy if exists "menu_item_extra_applicability_select_public" on public.menu_item_extra_applicability;
create policy "menu_item_extra_applicability_select_public"
  on public.menu_item_extra_applicability for select
  to anon, authenticated
  using (true);

drop policy if exists "menu_item_extra_applicability_write_general_manager" on public.menu_item_extra_applicability;
create policy "menu_item_extra_applicability_write_general_manager"
  on public.menu_item_extra_applicability for all
  to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

insert into public.menu_item_extra_applicability (extra_item_id, applies_to_item_id)
select extra.id, base.id
from public.menu_items extra
cross join public.menu_items base
where extra.name = 'إضافة موتزريلا للطاجن'
  and base.name in ('طاجن فراخ', 'طاجن لحم', 'طاجن خضار')
on conflict (extra_item_id, applies_to_item_id) do nothing;
