-- Some branches are dine-in/takeaway only (is_delivery_available = false)
-- but still need delivery orders auto-routed to a nearby sister branch
-- instead of just failing. Karim's mapping: المراغي -> المروة,
-- شارع 7 -> شارع 9. Generic column (not hardcoded to these two) so any
-- future dine-in-only branch can point at whichever branch should cover
-- its deliveries.

alter table public.branches
  add column if not exists delivery_fallback_branch_id int references public.branches(id);

update public.branches set delivery_fallback_branch_id = (select id from public.branches where name = 'المروة')
  where name = 'المراغي';

update public.branches set delivery_fallback_branch_id = (select id from public.branches where name = 'شارع 9')
  where name = 'شارع 7';
