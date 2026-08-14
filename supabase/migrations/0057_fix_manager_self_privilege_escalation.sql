-- Security audit finding CRIT-1 (Batch 4, 2026-08-14): prevent_self_privilege_escalation()
-- (0001) was written to guard the users_update_self RLS policy (id = auth.uid(), no column
-- restriction) against a caller promoting their own role/branch_id/region_id/is_active. Its
-- condition exempted branch_manager and regional_manager alongside general_manager - per 0001's
-- own comment, "Prevent non-managers from promoting themselves", i.e. this was the original,
-- deliberate (but mistaken) design: only general_manager should ever have been exempt, since a
-- general_manager modifying their own row isn't an escalation (they already have unrestricted
-- access via users_update_general_manager). branch_manager/regional_manager are NOT already
-- unrestricted - their own separate UPDATE policies (users_update_branch_manager,
-- users_update_regional_manager) only ever touch OTHER users' rows (subordinates), scoped and
-- role-capped by those policies' own with_check clauses. Exempting them from THIS trigger meant
-- the only guard on their SELF row was gone entirely.
--
-- Live-confirmed exploitable: a disposable branch_manager account PATCHed its own row via
-- PostgREST (users_update_self, own JWT, no edge function) with {"role":"general_manager"} and
-- succeeded - full self-promotion to the top role, no rate limit, no audit log entry, one API call.
--
-- Fix: only general_manager remains exempt. This only affects a caller updating their OWN row
-- (auth.uid() = old.id) - branch_manager/regional_manager updating a subordinate's row (old.id
-- != auth.uid()) never enters this branch and is unaffected, so legitimate manager-manages-
-- subordinate flows (users_update_branch_manager/users_update_regional_manager, already scoped
-- and role-capped by their own RLS with_check) keep working exactly as before.
create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and current_user_role()::text != 'general_manager' then
    if new.role is distinct from old.role
       or new.branch_id is distinct from old.branch_id
       or new.region_id is distinct from old.region_id
       or new.is_active is distinct from old.is_active then
      raise exception 'not allowed to change role/branch/region/active status on your own account';
    end if;
  end if;
  return new;
end;
$$;
