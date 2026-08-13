-- Karim's explicit instruction (2026-08-11): team_leader can stop/activate
-- a menu item, company-wide (same breadth as their existing order
-- visibility - no branch/region restriction elsewhere in this role).
drop policy if exists "menu_item_branch_closures_write_scoped" on public.menu_item_branch_closures;
create policy "menu_item_branch_closures_write_scoped"
  on public.menu_item_branch_closures for insert to authenticated
  with check (
    current_user_is_active()
    and (
      current_user_role()::text in ('general_manager', 'team_leader')
      or (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
      or (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
    )
  );

drop policy if exists "menu_item_branch_closures_delete_scoped" on public.menu_item_branch_closures;
create policy "menu_item_branch_closures_delete_scoped"
  on public.menu_item_branch_closures for delete to authenticated
  using (
    current_user_is_active()
    and (
      current_user_role()::text in ('general_manager', 'team_leader')
      or (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
      or (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
    )
  );
