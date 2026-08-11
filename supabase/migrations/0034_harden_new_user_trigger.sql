-- Fixes a privilege-escalation hole confirmed live 2026-08-11: this trigger
-- used to read role/branch_id/region_id directly from raw_user_meta_data
-- (fully client-controlled at signup time via auth.signUp()'s options.data),
-- letting anyone self-grant any role including general_manager with zero
-- approval - proven live via the public anon key's own /auth/v1/signup
-- endpoint, then cleaned up.
--
-- Verified safe (traced through every account-creation call site in the
-- repo, not assumed): create-user is the only path that legitimately needs
-- a non-customer role, and it already overwrites whatever this trigger
-- inserts with its own authorization-matrix-validated values via a
-- separate service_role UPDATE immediately afterward - see
-- supabase/functions/create-user/index.ts. This change does not alter
-- that function's behavior. customer-web (signUp + Google OAuth) and
-- create-order's guest-account path never passed a role via metadata to
-- begin with.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, phone, role, branch_id, region_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    'customer',
    null,
    null
  );
  return new;
end;
$$;
