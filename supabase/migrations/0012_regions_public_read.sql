-- Fixes a real gap found via live testing: regions was only ever granted
-- to `authenticated` (0001), because every consumer of it before now was
-- logged-in (staff dashboard, a logged-in customer's address form). The
-- new public Branches page (customer-web /branches) reads it with no
-- login at all, the same way it already reads `branches` - and `branches`
-- already grants anon (branches_select_public, 0001) but regions never
-- did, so the region groupings on that page silently rendered empty for
-- anonymous visitors. Region names aren't sensitive - same openness as
-- branches itself, just extending the exact same pattern.

grant select on public.regions to anon;

drop policy if exists "regions_select_authenticated" on public.regions;
drop policy if exists "regions_select_public" on public.regions;
create policy "regions_select_public"
  on public.regions for select
  to anon, authenticated
  using (true);
