-- Storage bucket for branch photos (branches.photo_url, added in 0011)
-- never actually got an admin screen or a bucket to upload into - found
-- live when the owner tried to add them and had nowhere to do it. Same
-- pattern as 0008's menu-images bucket: public bucket (customer-web's
-- Branches.tsx renders these to anonymous browsers), general_manager-only
-- write, path convention branch-images/{branch_id}.jpg, upsert overwrites.
insert into storage.buckets (id, name, public)
values ('branch-images', 'branch-images', true)
on conflict (id) do nothing;

drop policy if exists "branch_images_write_general_manager" on storage.objects;
create policy "branch_images_write_general_manager"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'branch-images' and current_user_role()::text = 'general_manager')
  with check (bucket_id = 'branch-images' and current_user_role()::text = 'general_manager');
