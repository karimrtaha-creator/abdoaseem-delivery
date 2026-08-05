-- Found via live testing (customer-web order tracking page): the
-- `supabase_realtime` publication has ZERO tables in it on this project
-- (confirmed via `select * from pg_publication_tables where pubname =
-- 'supabase_realtime'` returning no rows at all). Every screen in this
-- codebase that calls `.channel(...).on("postgres_changes", ...)` -
-- AcceptanceLobby, Dashboard, Dispatch, Complaints (dispatcher-web) and
-- now Orders (customer-web) - has silently never received a single live
-- push update; they only ever showed data from their initial load. This
-- adds the two tables actually subscribed to anywhere in the codebase.
--
-- Idempotent: pg_publication_tables check first so re-running this on a
-- project where the tables are already added is a no-op rather than an
-- error (ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS form).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'complaints'
  ) then
    alter publication supabase_realtime add table public.complaints;
  end if;
end $$;
