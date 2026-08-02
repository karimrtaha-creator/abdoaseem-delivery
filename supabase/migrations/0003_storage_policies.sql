-- Storage RLS for the two buckets this phase needs. Buckets were created
-- via the Storage Admin API (both private, not public):
--   - receipts:        dispatcher's exit-confirmation photo (section 6)
--   - payment-proofs:  instapay transfer screenshots (section 6, ahead of
--                       Phase 2/4 call-center + customer-app work)
--
-- Path convention (enforced by the policies, must be respected by callers):
--   receipts/{branch_id}/{order_id}-{timestamp}.jpg
--   payment-proofs/{customer_user_id}/{timestamp}.jpg

drop policy if exists "receipts_insert_dispatcher" on storage.objects;
create policy "receipts_insert_dispatcher"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and current_user_role()::text = 'dispatcher'
    and (storage.foldername(name))[1] = current_user_branch_id()::text
  );

drop policy if exists "receipts_select_scoped" on storage.objects;
create policy "receipts_select_scoped"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and (
      current_user_role()::text in ('general_manager', 'team_leader')
      or (
        current_user_role()::text = 'regional_manager'
        and (storage.foldername(name))[1]::int in (select public.current_user_region_branch_ids())
      )
      or (
        current_user_role()::text in ('branch_manager', 'dispatcher')
        and (storage.foldername(name))[1]::int = current_user_branch_id()
      )
    )
  );

drop policy if exists "payment_proofs_insert_owner_or_staff" on storage.objects;
create policy "payment_proofs_insert_owner_or_staff"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or current_user_role()::text in ('call_center', 'general_manager', 'team_leader')
    )
  );

drop policy if exists "payment_proofs_select_owner_or_staff" on storage.objects;
create policy "payment_proofs_select_owner_or_staff"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or current_user_role()::text in ('call_center', 'general_manager', 'team_leader')
    )
  );
