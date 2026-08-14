-- Security audit finding MEDIUM-1 (Batch 6, 2026-08-14): delivery_zones_select_authenticated
-- (0024) granted SELECT true to every authenticated role with no scoping at all - any logged-in
-- customer (a free, self-service signup) could dump every zone's exact delivery_fee company-wide
-- in one PostgREST call. Live-confirmed in the audit: a disposable customer token read all 644
-- rows in one request.
--
-- Inspection of actual usage before this fix (see Batch 6 report for detail):
--   - BranchManagement.tsx (general_manager-only screen, per TABS_BY_ROLE) bulk-reads ALL zones'
--     fees company-wide - a real, legitimate need for the one role that manages pricing.
--   - Addresses.tsx (customer-web) bulk-reads a branch's zones while a customer searches for
--     their street - but the fee is deliberately hidden in that dropdown until a zone is picked
--     (Karim's 2026-08-13 "hide per-zone prices from the search dropdown" instruction) - the fee
--     was already unnecessary at that step, just over-fetched alongside the names.
--   - Checkout.tsx (customer-web) reads exactly one zone's fee - the customer's own already-saved
--     address's zone_id - a single-row, per-customer need.
-- No screen anywhere needs a customer/driver/dispatcher/call_center role to bulk-read delivery_fee
-- across many zones at once.
--
-- Postgres RLS is row-level, not column-level, so it can't express "this role sees this row but
-- not this column" directly. The fix instead:
--   1. Replaces the blanket SELECT policy with one scoped to general_manager/team_leader -
--      exactly the same role pair delivery_zones_write_general_manager already trusts with WRITE,
--      so read access now mirrors write access instead of being wider than it.
--   2. Adds delivery_zones_directory, an owner-privilege view (reads past the now-tighter base
--      table RLS, standard Postgres column-masking pattern) exposing only the non-sensitive browse
--      columns (id, branch_id, zone_name, is_active) to any authenticated user - what the search
--      step actually needs.
--   3. Adds get_zone_delivery_fee(p_zone_id), a SECURITY DEFINER function bounded to exactly one
--      zone per call - the only way a non-staff role can retrieve a delivery_fee value now. A
--      single bulk dump is no longer possible; reconstructing the full price list would require a
--      script making 644 separate distinguishable calls instead of one.

drop policy if exists "delivery_zones_select_authenticated" on public.delivery_zones;

create policy "delivery_zones_select_staff"
  on public.delivery_zones for select
  to authenticated
  using (current_user_role()::text = any (array['general_manager', 'team_leader']));

create view public.delivery_zones_directory as
  select id, branch_id, zone_name, is_active
  from public.delivery_zones;

grant select on public.delivery_zones_directory to authenticated;

create function public.get_zone_delivery_fee(p_zone_id bigint)
returns table (delivery_fee numeric, zone_name text, is_active boolean)
language sql
security definer
set search_path = public
as $$
  select delivery_fee, zone_name, is_active
  from public.delivery_zones
  where id = p_zone_id;
$$;

-- Same lesson CRIT-2 (Batch 4) taught: a new function gets EXECUTE granted to
-- PUBLIC by default unless explicitly revoked - do that up front this time.
revoke execute on function public.get_zone_delivery_fee(bigint) from public, anon;
grant execute on function public.get_zone_delivery_fee(bigint) to authenticated;
