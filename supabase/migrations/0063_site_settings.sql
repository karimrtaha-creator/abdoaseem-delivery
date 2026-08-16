-- Karim wants to swap the homepage promo video from the Staff Portal
-- instead of a code change every time (previously PROMO_VIDEO_URL was a
-- hardcoded constant in Home.tsx). Same singleton-settings pattern as
-- business_hours (0019) and combo_section_settings (0048) - a one-row
-- table, publicly readable, writable only by the same roles that already
-- manage business_hours.
create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  promo_video_url text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id, promo_video_url)
  values (1, 'https://www.facebook.com/Koshryelghobashy/videos/816767713756781/')
  on conflict (id) do nothing;

alter table public.site_settings enable row level security;
grant select on public.site_settings to anon, authenticated;
grant update on public.site_settings to authenticated;

create policy "site_settings_select_public"
  on public.site_settings for select
  to anon, authenticated
  using (true);

create policy "site_settings_update_managers"
  on public.site_settings for update
  to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader') and current_user_is_active())
  with check (current_user_role()::text in ('general_manager', 'team_leader') and current_user_is_active());
