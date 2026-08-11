-- Staff Registration feature (2026-08-11, per staff_registration_design.md,
-- built after the mandatory dispatcher-photo-gate feature and the
-- handle_new_user() privilege-escalation fix). Deliberately kept fully
-- separate from public.users, which stays "approved accounts only" -
-- Karim's explicit preference.
create table public.staff_registration_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_name text not null,
  requested_role user_role not null,
  requested_branch_id bigint references public.branches(id),
  requested_region_id bigint references public.regions(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  -- One open request per person at a time - a rejected or approved row
  -- never blocks a fresh submission, only another still-pending one.
  constraint one_pending_request_per_user
    exclude (user_id with =) where (status = 'pending')
);
create index idx_staff_registration_requests_user_id on public.staff_registration_requests (user_id);

alter table public.staff_registration_requests enable row level security;

-- service_role (both edge functions) - full access, as everywhere else in this schema.
create policy "staff_registration_requests_service_role"
  on public.staff_registration_requests for all to service_role
  using (true) with check (true);

-- No authenticated-role INSERT/UPDATE policy exists anywhere below - this
-- is deliberate, not an oversight: every write to this table goes through
-- submit-staff-registration or approve-staff-registration (service_role),
-- which re-validate everything server-side. A client token, however
-- valid, has no RLS path to write this table directly.

-- The requester can see their own request's status (read-only).
create policy "staff_registration_requests_select_self"
  on public.staff_registration_requests for select to authenticated
  using (user_id = auth.uid());

-- general_manager: every request, any status (not just pending) - Karim's
-- decision that resolved requests stay visible with who decided them.
create policy "staff_registration_requests_select_general_manager"
  on public.staff_registration_requests for select to authenticated
  using (current_user_role()::text = 'general_manager' and public.current_user_is_active());

-- regional_manager: requests targeting a branch in their region, or a
-- regional_manager request for their own region - any status.
create policy "staff_registration_requests_select_regional_manager"
  on public.staff_registration_requests for select to authenticated
  using (
    current_user_role()::text = 'regional_manager'
    and public.current_user_is_active()
    and (
      requested_branch_id in (select public.current_user_region_branch_ids())
      or requested_region_id = current_user_region_id()
    )
  );

-- branch_manager: requests targeting their own branch only - any status.
create policy "staff_registration_requests_select_branch_manager"
  on public.staff_registration_requests for select to authenticated
  using (
    current_user_role()::text = 'branch_manager'
    and public.current_user_is_active()
    and requested_branch_id = current_user_branch_id()
  );
