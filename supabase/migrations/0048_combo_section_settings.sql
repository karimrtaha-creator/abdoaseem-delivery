-- Karim wants to be able to rename the "الكومبوهات" section himself from
-- the Staff/Admin Portal, not ask for a code change every time. Combos
-- aren't real menu_categories rows (different structure - choice groups,
-- no category_id, rendered in their own dedicated section everywhere),
-- so this is a tiny standalone singleton (same pattern as business_hours,
-- 0019) rather than folding combos into menu_categories, which would
-- have meant rewriting how combos are grouped/rendered across three files
-- for a label that's the only thing actually shared with real categories.
create table if not exists public.combo_section_settings (
  id smallint primary key default 1 check (id = 1),
  label text not null default 'الكومبوهات',
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

insert into public.combo_section_settings (id) values (1) on conflict (id) do nothing;

alter table public.combo_section_settings enable row level security;
grant select on public.combo_section_settings to anon, authenticated;
grant update on public.combo_section_settings to authenticated;

create policy "combo_section_settings_select_public"
  on public.combo_section_settings for select
  to anon, authenticated
  using (true);

-- general_manager only, matching combo_offers' own write scope
-- (combo_offers_write_general_manager) - team_leader can manage
-- per-branch combo closures but not this.
create policy "combo_section_settings_update_general_manager"
  on public.combo_section_settings for update
  to authenticated
  using (current_user_role()::text = 'general_manager' and current_user_is_active())
  with check (current_user_role()::text = 'general_manager' and current_user_is_active());
