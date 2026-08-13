-- Karim wants to control the order products appear in within each menu
-- category (currently just whatever order the DB happens to return, in
-- practice insertion/id order - no real control anywhere). Backfill gives
-- every existing item a sequential order within its own category, seeded
-- from current id order, so nothing visually jumps the moment this ships -
-- only starts moving once someone actually uses the new reorder buttons.
alter table public.menu_items
  add column display_order integer;

with numbered as (
  select id, row_number() over (partition by category_id order by id) as rn
  from public.menu_items
)
update public.menu_items m
set display_order = numbered.rn
from numbered
where m.id = numbered.id;

alter table public.menu_items
  alter column display_order set not null,
  alter column display_order set default 0;
