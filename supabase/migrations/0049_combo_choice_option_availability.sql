-- Karim wants to disable a single choice within a combo (e.g. "2 ماكسي
-- كولا" out of كومبو الاحتفال 1's "اختار الحلو والمشروب" group) without
-- touching the combo itself or its other options. combo_choice_options
-- had no way to represent "temporarily not offered" - default true so
-- every existing option keeps working exactly as before.
alter table public.combo_choice_options
  add column is_available boolean not null default true;
