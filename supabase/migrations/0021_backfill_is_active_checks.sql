-- Backfill fix, found during a full audit: migration 0006 established the
-- rule that every staff-role-scoped RLS policy must also check
-- current_user_is_active(), so a just-deactivated staff member's
-- still-valid (not yet expired) access token can't keep writing data via
-- direct table access during the window before their token naturally
-- expires (0006's own comment explains why this matters - the ban on their
-- auth account only blocks re-authentication, not an already-issued JWT).
--
-- Four tables added AFTER 0006 never got this check added to their
-- staff-write policies: menu_item_branch_closures (0009), menu_item_extra_
-- applicability (0010), combo_choice_groups/combo_choice_options (0016),
-- and order_ratings' staff select policy (0018). This closes that gap by
-- reissuing those policies with the same is_active check every earlier
-- staff policy already has.

drop policy if exists "menu_item_branch_closures_write_scoped" on public.menu_item_branch_closures;
create policy "menu_item_branch_closures_write_scoped"
  on public.menu_item_branch_closures for insert
  to authenticated
  with check (
    current_user_is_active() and (
      current_user_role()::text = 'general_manager'
      or (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
      or (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
    )
  );

drop policy if exists "menu_item_branch_closures_delete_scoped" on public.menu_item_branch_closures;
create policy "menu_item_branch_closures_delete_scoped"
  on public.menu_item_branch_closures for delete
  to authenticated
  using (
    current_user_is_active() and (
      current_user_role()::text = 'general_manager'
      or (current_user_role()::text = 'regional_manager' and branch_id in (select public.current_user_region_branch_ids()))
      or (current_user_role()::text = 'branch_manager' and branch_id = current_user_branch_id())
    )
  );

drop policy if exists "menu_item_extra_applicability_write_general_manager" on public.menu_item_extra_applicability;
create policy "menu_item_extra_applicability_write_general_manager"
  on public.menu_item_extra_applicability for all
  to authenticated
  using (current_user_role()::text = 'general_manager' and current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and current_user_is_active());

drop policy if exists "combo_choice_groups_write_general_manager" on public.combo_choice_groups;
create policy "combo_choice_groups_write_general_manager"
  on public.combo_choice_groups for all to authenticated
  using (current_user_role()::text = 'general_manager' and current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and current_user_is_active());

drop policy if exists "combo_choice_options_write_general_manager" on public.combo_choice_options;
create policy "combo_choice_options_write_general_manager"
  on public.combo_choice_options for all to authenticated
  using (current_user_role()::text = 'general_manager' and current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and current_user_is_active());

drop policy if exists "order_ratings_select_staff" on public.order_ratings;
create policy "order_ratings_select_staff"
  on public.order_ratings for select to authenticated
  using (
    current_user_is_active()
    and exists (
      select 1 from public.orders o
      where o.id = order_ratings.order_id
        and (
          current_user_role()::text in ('general_manager', 'team_leader')
          or (current_user_role()::text = 'regional_manager' and o.branch_id in (select public.current_user_region_branch_ids()))
          or (current_user_role()::text = 'branch_manager' and o.branch_id = current_user_branch_id())
        )
    )
  );
