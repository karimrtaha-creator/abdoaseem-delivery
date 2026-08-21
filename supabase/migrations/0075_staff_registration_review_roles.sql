-- Karim's request (2026-08-21): dispatcher and team_leader gain narrow
-- staff-registration review authority (dispatcher: driver requests for
-- their own branch only; team_leader: call_center/Agent requests) -
-- matches approve-staff-registration's new canReview() check. Neither
-- role had any SELECT policy on this table before, so they couldn't even
-- see a pending request to act on it. branch_manager/regional_manager's
-- own policies are left in place (inert, not deleted) - branch_manager/
-- regional_manager were retired as roles the same day, matching the
-- "leave unused RLS harmlessly in place rather than touch every policy
-- file" call made for roleScopes.ts.
create policy "staff_registration_requests_select_dispatcher"
  on public.staff_registration_requests for select
  to authenticated
  using (
    current_user_role()::text = 'dispatcher'
    and current_user_is_active()
    and requested_role = 'driver'
    and requested_branch_id = current_user_branch_id()
  );

create policy "staff_registration_requests_select_team_leader"
  on public.staff_registration_requests for select
  to authenticated
  using (
    current_user_role()::text = 'team_leader'
    and current_user_is_active()
    and requested_role = 'call_center'
  );
