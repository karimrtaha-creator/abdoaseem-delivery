-- Karim wants to show more than one homepage promo video (was a single
-- site_settings.promo_video_url) and to be able to add/remove entries
-- freely - generalizes 0063's singleton into a list, same
-- general_manager/team_leader write access, same public read. The
-- existing single video (if any) is carried over as the first row so
-- nothing disappears from the homepage during the migration.
create table public.promo_videos (
  id bigint generated always as identity primary key,
  video_url text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

insert into public.promo_videos (video_url, created_by)
select promo_video_url, updated_by from public.site_settings where id = 1 and promo_video_url is not null;

alter table public.site_settings drop column promo_video_url;

alter table public.promo_videos enable row level security;
grant select on public.promo_videos to anon, authenticated;
grant insert, delete on public.promo_videos to authenticated;

create policy "promo_videos_select_public"
  on public.promo_videos for select
  to anon, authenticated
  using (true);

create policy "promo_videos_write_managers"
  on public.promo_videos for insert
  to authenticated
  with check (current_user_role()::text in ('general_manager', 'team_leader') and current_user_is_active());

create policy "promo_videos_delete_managers"
  on public.promo_videos for delete
  to authenticated
  using (current_user_role()::text in ('general_manager', 'team_leader') and current_user_is_active());
