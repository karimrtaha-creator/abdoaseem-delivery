-- Discovered while testing dispatch-order: unlike a normal Supabase
-- project, `service_role` on this project has ZERO privileges on any
-- public-schema table (confirmed via REST: every table returns 42501
-- "permission denied for table X" even for service_role, not just
-- anon/authenticated). Every edge function in supabase/functions/ uses
-- the service_role key specifically to bypass RLS after doing its own
-- authorization check - without this grant, every DB call inside every
-- function silently fails with 42501, which getCaller() in
-- supabase/functions/_shared/auth.ts currently surfaces as a generic
-- "unauthorized" (401) instead of a server error, which is what made this
-- look like a bad token/role check instead of a missing GRANT.
--
-- Idempotent: GRANT is a no-op if already granted, ALTER DEFAULT
-- PRIVILEGES safely replaces the prior default rule for this role.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
