-- Real per-branch delivery-fee/SLA data from the owner (spreadsheet:
-- "الخدمات وزمن الخدمة.xlsx"). Two structural gaps this closes:
--
--   1. Delivery fee was a single flat number per branch (branches.
--      delivery_fee, 0017) - the spreadsheet shows it's actually per-zone
--      within a branch (e.g. one street pays 20ج, another pays 45ج from
--      the same branch). delivery_zones below is the new zone->fee table;
--      branches.delivery_fee stays as-is and now acts as the fallback for
--      addresses that aren't matched to a zone (old addresses, or branches
--      with no zone data yet - see 0025's note on فرع مايو).
--
--   2. sla_tiers (fee -> sla_minutes) was a single company-wide table -
--      the spreadsheet shows 2 different per-branch patterns (10 of 13
--      branches have real data; see 0025). branch_id is added as nullable
--      rather than required: the 4 existing global rows are kept exactly
--      as they are and now act as the fallback for any branch with no
--      branch-scoped tiers of its own (today: فرع مايو, and شارع 7/
--      المراغي which redirect to a fallback branch before dispatch ever
--      happens anyway - see 0014).

create table if not exists public.delivery_zones (
  id bigint generated always as identity primary key,
  branch_id int not null references public.branches(id),
  zone_name text not null,
  delivery_fee numeric not null,
  created_at timestamptz not null default now(),
  unique (branch_id, zone_name)
);

alter table public.delivery_zones enable row level security;

grant select on public.delivery_zones to authenticated;
grant insert, update, delete on public.delivery_zones to authenticated;

drop policy if exists "delivery_zones_select_authenticated" on public.delivery_zones;
create policy "delivery_zones_select_authenticated"
  on public.delivery_zones for select
  to authenticated
  using (true);

-- Same role scope as business_hours (0019): whoever can set the site's
-- opening hours can also set per-zone delivery pricing.
drop policy if exists "delivery_zones_write_general_manager" on public.delivery_zones;
create policy "delivery_zones_write_general_manager"
  on public.delivery_zones for all to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader') and current_user_is_active())
  with check (current_user_role()::text in ('general_manager', 'team_leader') and current_user_is_active());

alter table public.customer_addresses
  add column if not exists zone_id bigint references public.delivery_zones(id);

alter table public.sla_tiers
  add column if not exists branch_id int references public.branches(id);

-- Per-branch SLA tiers. Two patterns from the spreadsheet:
--   Pattern A (7 branches): 0-28 -> 30min, 29-40 -> 45min, 41+ -> 60min
--   Pattern B (3 branches, أطول شوية): 0-20 -> 30min, 21-25 -> 40min,
--     26-35 -> 45min, 36+ -> 60min
-- Upper bound left NULL (unbounded) same as the existing global tier 4.
do $$
declare
  pattern_a_branches int[] := array[11, 12, 4, 1, 13, 2, 10]; -- أحمد فخري, الألف مسكن, الهضبة الوسطى, زهراء المعادي, زهراء عين شمس, شارع 9, مكرم
  pattern_b_branches int[] := array[7, 9, 8]; -- المروة, حيدر, شريف
  b int;
begin
  foreach b in array pattern_a_branches loop
    delete from public.sla_tiers where branch_id = b;
    insert into public.sla_tiers (branch_id, min_price, max_price, sla_minutes) values
      (b, 0, 28, 30),
      (b, 29, 40, 45),
      (b, 41, null, 60);
  end loop;

  foreach b in array pattern_b_branches loop
    delete from public.sla_tiers where branch_id = b;
    insert into public.sla_tiers (branch_id, min_price, max_price, sla_minutes) values
      (b, 0, 20, 30),
      (b, 21, 25, 40),
      (b, 26, 35, 45),
      (b, 36, null, 60);
  end loop;
end $$;
