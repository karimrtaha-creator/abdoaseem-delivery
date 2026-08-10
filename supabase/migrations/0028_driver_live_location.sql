-- Live driver location, shown on a map to dispatcher/team_leader/
-- general_manager - only while a driver is actually carrying an order
-- (the app decides when to start/stop sending updates; nothing here
-- enforces that server-side, same trust boundary as the one-off
-- "pin customer location" feature in customer_addresses, 0005).
--
-- No new RLS needed: users_select_general_manager_team_leader and
-- users_select_dispatcher_branch_drivers (0006) already expose every
-- column on these rows to exactly the right staff roles, and
-- users_update_self (0001) already lets a driver update their own row -
-- these are just new columns on an already-covered table.
alter table public.users
  add column if not exists current_lat double precision,
  add column if not exists current_lng double precision,
  add column if not exists location_updated_at timestamptz;
