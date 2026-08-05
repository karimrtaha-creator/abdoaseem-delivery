-- Storage bucket for menu item photos (Karim's request: let general_manager
-- attach a photo to each menu item from a new internal admin screen).
--
-- Public bucket (unlike receipts/payment-proofs) - menu photos need to
-- render on customer-web for anonymous browsers with no auth at all, so
-- there is no read policy to write; Supabase serves public-bucket objects
-- directly via /storage/v1/object/public/... regardless of RLS.
--
-- Path convention: menu-images/{menu_item_id}.jpg - one photo per item,
-- re-uploading overwrites (upsert) rather than accumulating old files.
--
-- Idempotent: ON CONFLICT DO NOTHING for the bucket row, DROP POLICY IF
-- EXISTS before CREATE for the RLS policies.

insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

drop policy if exists "menu_images_write_general_manager" on storage.objects;
create policy "menu_images_write_general_manager"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'menu-images' and current_user_role()::text = 'general_manager')
  with check (bucket_id = 'menu-images' and current_user_role()::text = 'general_manager');
