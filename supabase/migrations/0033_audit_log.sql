-- Finding #006 (security audit): append-only audit trail for security-
-- relevant actions (role/account changes, order lifecycle transitions).
-- Written exclusively by edge functions via the service_role admin client
-- (see supabase/functions/_shared/audit.ts) - no INSERT/UPDATE/DELETE
-- policy is granted to any authenticated role, so nothing reachable from
-- the client apps can create, edit, or erase an entry. general_manager can
-- read; no one else can, per spec.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_role text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  branch_id integer references public.branches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_actor_idx on public.audit_log (actor_user_id);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

-- Only the service_role (which bypasses RLS entirely) writes here - no
-- insert/update/delete policy is defined for `authenticated`, so those
-- statements are denied by RLS's default-deny for any client-side caller.
grant select on public.audit_log to authenticated;

drop policy if exists "audit_log_select_general_manager" on public.audit_log;
create policy "audit_log_select_general_manager"
  on public.audit_log for select
  to authenticated
  using (current_user_role()::text = 'general_manager');
