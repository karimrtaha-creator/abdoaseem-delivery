-- Per-branch menu item availability ("اقفل صنف من فرع معين"). Exceptions
-- table, not a full item x branch matrix: presence of a row means that
-- item is currently closed at that branch; absence means available (the
-- common case, so most items/branches never get a row at all).
--
-- Scoping (per Karim's explicit choice): branch_manager can open/close
-- items at their own branch only, regional_manager at any branch in their
-- own region, general_manager anywhere - mirrors the exact same three-tier
-- scoping already used for branch/user management elsewhere in this
-- project (current_user_region_branch_ids() is the same helper added in
-- an earlier migration for that).
--
-- Read access is public (anon + authenticated): customer-web needs to
-- check closures for the customer's nearest branch without requiring a
-- customer to be logged in first, and there's nothing sensitive in "this
-- item is closed today" - same openness as menu_items itself.

create table if not exists public.menu_item_branch_closures (
  id bigint generated always as identity primary key,
  menu_item_id bigint not null references public.menu_items(id) on delete cascade,
  branch_id int not null references public.branches(id) on delete cascade,
  closed_by uuid references public.users(id),
  closed_at timestamptz not null default now(),
  unique (menu_item_id, branch_id)
);

alter table public.menu_item_branch_closures enable row level security;

grant select on public.menu_item_branch_closures to anon, authenticated;
grant insert, delete on public.menu_item_branch_closures to authenticated;

drop policy if exists "menu_item_branch_closures_select_public" on public.menu_item_branch_closures;
create policy "menu_item_branch_closures_select_public"
  on public.menu_item_branch_closures for select
  to anon, authenticated
  using (true);

drop policy if exists "menu_item_branch_closures_write_scoped" on public.menu_item_branch_closures;
create policy "menu_item_branch_closures_write_scoped"
  on public.menu_item_branch_closures for insert
  to authenticated
  with check (
    current_user_role()::text = 'general_manager'
    or (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
    or (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
  );

drop policy if exists "menu_item_branch_closures_delete_scoped" on public.menu_item_branch_closures;
create policy "menu_item_branch_closures_delete_scoped"
  on public.menu_item_branch_closures for delete
  to authenticated
  using (
    current_user_role()::text = 'general_manager'
    or (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
    or (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
  );
