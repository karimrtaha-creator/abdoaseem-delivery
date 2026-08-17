-- Code review finding (2026-08-17): two staff-read RLS policies check
-- current_user_role() but never current_user_is_active(), regressing the
-- pattern 0006/0021 established everywhere else - a deactivated
-- general_manager/team_leader/branch_manager/regional_manager with a still-
-- live JWT session (browser tab open, token not yet expired) could keep
-- reading through these two policies after being cut off everywhere else.
drop policy if exists "delivery_zones_select_staff" on public.delivery_zones;
create policy "delivery_zones_select_staff"
  on public.delivery_zones for select
  to authenticated
  using (current_user_role()::text = any (array['general_manager', 'team_leader']) and current_user_is_active());

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
