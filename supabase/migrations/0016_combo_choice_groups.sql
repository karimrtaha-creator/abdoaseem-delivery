-- Combo offers were always fixed bundles. Karim wants the 3 real combos to
-- let the customer pick within them:
--   1: fixed (2 كشري + توست + سلطة) + one choice of {2 حلو / 2 ماكسي كولا / 1 و1}
--   2: choice of {2 طاجن فراخ / 2 طاجن لحمة / 1 و1} + the same حلو/كولا choice
--      (this combo used to say "طاجن لحمة أو فراخ" - one tagine; now it's
--      two, price stays 130ج unchanged per Karim's explicit confirmation)
--   3: fixed (كشري + توست + سلطة) + choice of {فراخ / لحمة} (single tagine,
--      single-select, not a quantity choice like the other two combos) +
--      the same حلو/كولا choice
--
-- "2 ماكسي كولا" isn't a real standalone product (confirmed with Karim -
-- not sold separately), so choice options are plain descriptive labels,
-- not FKs into menu_items - "2 حلو" is specifically "أرز بلبن صغير" by his
-- own clarification but that's still just describing what the option
-- means, not something a customer could buy piecemeal outside the combo.
--
-- order_items.combo_selection stores the resolved, server-validated
-- selection text (e.g. "الطاجن: 2 طاجن فراخ | الحلو والمشروب: 1 و1") so
-- kitchen/dispatch/customer-tracking all see exactly what was chosen -
-- never trust the client's own text for this, same "re-validate
-- server-side" rule already used for prices (create-order resolves the
-- option ids it's given against these tables and writes the label itself).

create table if not exists public.combo_choice_groups (
  id bigint generated always as identity primary key,
  combo_offer_id int not null references public.combo_offers(id) on delete cascade,
  label text not null,
  display_order int not null default 0
);

create table if not exists public.combo_choice_options (
  id bigint generated always as identity primary key,
  choice_group_id bigint not null references public.combo_choice_groups(id) on delete cascade,
  label text not null,
  display_order int not null default 0
);

alter table public.combo_choice_groups enable row level security;
alter table public.combo_choice_options enable row level security;

grant select on public.combo_choice_groups, public.combo_choice_options to anon, authenticated;
grant insert, update, delete on public.combo_choice_groups, public.combo_choice_options to authenticated;

drop policy if exists "combo_choice_groups_select_public" on public.combo_choice_groups;
create policy "combo_choice_groups_select_public"
  on public.combo_choice_groups for select to anon, authenticated using (true);

drop policy if exists "combo_choice_groups_write_general_manager" on public.combo_choice_groups;
create policy "combo_choice_groups_write_general_manager"
  on public.combo_choice_groups for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

drop policy if exists "combo_choice_options_select_public" on public.combo_choice_options;
create policy "combo_choice_options_select_public"
  on public.combo_choice_options for select to anon, authenticated using (true);

drop policy if exists "combo_choice_options_write_general_manager" on public.combo_choice_options;
create policy "combo_choice_options_write_general_manager"
  on public.combo_choice_options for all to authenticated
  using (current_user_role()::text = 'general_manager')
  with check (current_user_role()::text = 'general_manager');

alter table public.order_items
  add column if not exists combo_selection text;

-- Seed the 3 real combos' choice structure, matched by their existing
-- names so this is safe to re-run (delete-then-insert per combo).
do $$
declare
  combo1_id int; combo2_id int; combo3_id int;
  g1a bigint; g2a bigint; g2b bigint; g3a bigint; g3b bigint; g1_only bigint;
begin
  select id into combo1_id from public.combo_offers where name = 'كومبو الاحتفال 1';
  select id into combo2_id from public.combo_offers where name = 'كومبو الاحتفال 2';
  select id into combo3_id from public.combo_offers where name = 'كومبو الاحتفال 3';

  if combo1_id is not null then
    delete from public.combo_choice_groups where combo_offer_id = combo1_id;
    insert into public.combo_choice_groups (combo_offer_id, label, display_order)
      values (combo1_id, 'اختار الحلو والمشروب', 1) returning id into g1_only;
    insert into public.combo_choice_options (choice_group_id, label, display_order) values
      (g1_only, '2 حلو', 1),
      (g1_only, '2 ماكسي كولا', 2),
      (g1_only, '1 حلو و1 ماكسي كولا', 3);
  end if;

  if combo2_id is not null then
    delete from public.combo_choice_groups where combo_offer_id = combo2_id;
    insert into public.combo_choice_groups (combo_offer_id, label, display_order)
      values (combo2_id, 'اختار الطاجن', 1) returning id into g2a;
    insert into public.combo_choice_options (choice_group_id, label, display_order) values
      (g2a, '2 طاجن فراخ', 1),
      (g2a, '2 طاجن لحمة', 2),
      (g2a, '1 طاجن فراخ و1 طاجن لحمة', 3);

    insert into public.combo_choice_groups (combo_offer_id, label, display_order)
      values (combo2_id, 'اختار الحلو والمشروب', 2) returning id into g2b;
    insert into public.combo_choice_options (choice_group_id, label, display_order) values
      (g2b, '2 حلو', 1),
      (g2b, '2 ماكسي كولا', 2),
      (g2b, '1 حلو و1 ماكسي كولا', 3);
  end if;

  if combo3_id is not null then
    delete from public.combo_choice_groups where combo_offer_id = combo3_id;
    insert into public.combo_choice_groups (combo_offer_id, label, display_order)
      values (combo3_id, 'اختار الطاجن', 1) returning id into g3a;
    insert into public.combo_choice_options (choice_group_id, label, display_order) values
      (g3a, 'فراخ', 1),
      (g3a, 'لحمة', 2);

    insert into public.combo_choice_groups (combo_offer_id, label, display_order)
      values (combo3_id, 'اختار الحلو والمشروب', 2) returning id into g3b;
    insert into public.combo_choice_options (choice_group_id, label, display_order) values
      (g3b, '2 حلو', 1),
      (g3b, '2 ماكسي كولا', 2),
      (g3b, '1 حلو و1 ماكسي كولا', 3);
  end if;
end $$;
