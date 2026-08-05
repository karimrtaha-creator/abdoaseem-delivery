-- Two small additions Karim asked for:
--   1. A description field per menu item, so he can write a short blurb
--      for each product from the new admin screen.
--   2. combo_offers never had an image_url column (only menu_items did) -
--      Karim's latest photo batch includes real photos matching the
--      existing "كومبو الاحتفال 1/2/3" combos by name, so combos need the
--      same column menu_items already has.
--
-- No new RLS needed for either: menu_items_write_general_manager and
-- combo_offers_write_general_manager (0001) already cover general_manager
-- writing new columns on these tables, and menu_items_select_public /
-- combo_offers_select_public already cover public reads.

alter table public.menu_items
  add column if not exists description text;

alter table public.combo_offers
  add column if not exists image_url text;
