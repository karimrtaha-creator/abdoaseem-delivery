-- Karim asked for combo offers to get the same per-branch closure ability
-- items already have ("إقفال الأصناف مش موجود في الكومبوهات"). Mirrors
-- 0009_menu_item_branch_closures.sql exactly, including the team_leader
-- write scope 0043 later added to the item version - built to match the
-- CURRENT final shape of that table's policies, not its original 0009
-- form, so this doesn't need its own follow-up migration the way items did.
create table if not exists public.combo_offer_branch_closures (
  id bigint generated always as identity primary key,
  combo_offer_id bigint not null references public.combo_offers(id) on delete cascade,
  branch_id int not null references public.branches(id) on delete cascade,
  closed_by uuid references public.users(id),
  closed_at timestamptz not null default now(),
  unique (combo_offer_id, branch_id)
);

alter table public.combo_offer_branch_closures enable row level security;

-- RLS narrows an already-granted permission, it doesn't create one on its
-- own - this exact gotcha has bitten this project twice before (see
-- staff_registration_requests, migration 0041). Grant first.
grant select on public.combo_offer_branch_closures to anon, authenticated;
grant insert, delete on public.combo_offer_branch_closures to authenticated;

create policy "combo_offer_branch_closures_select_public"
  on public.combo_offer_branch_closures for select
  to anon, authenticated
  using (true);

create policy "combo_offer_branch_closures_write_scoped"
  on public.combo_offer_branch_closures for insert
  to authenticated
  with check (
    current_user_is_active()
    and (
      current_user_role()::text in ('general_manager', 'team_leader')
      or (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
      or (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
    )
  );

create policy "combo_offer_branch_closures_delete_scoped"
  on public.combo_offer_branch_closures for delete
  to authenticated
  using (
    current_user_is_active()
    and (
      current_user_role()::text in ('general_manager', 'team_leader')
      or (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
      or (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
    )
  );
