-- Security audit finding MEDIUM-2 residual (Batch 8, 2026-08-14): receipts and payment-proofs
-- were explicitly left out of Batch 6's fix (a full public-vs-private risk-priority call at the
-- time) - both still validate uploaded MIME type by client-declared Content-Type header only,
-- same underlying platform gap already closed for menu-images/branch-images.
--
-- Fix: remove the direct-client storage write policies for both buckets, matching Batch 6's
-- pattern exactly - the new upload-receipt and upload-payment-proof edge functions (service_role)
-- are now the only way in, and they check actual image magic bytes before ever writing. Reads are
-- completely untouched: receipts_select_scoped and payment_proofs_select_owner_or_staff (both
-- private, RLS-gated buckets - no public-URL bypass like the menu-images/branch-images case) keep
-- exactly the same scoping they always had, so every existing signed-URL flow
-- (AcceptanceLobby.tsx's createSignedUrl for payment proofs, and the equivalent for receipts)
-- continues to work unchanged.
drop policy if exists "receipts_insert_dispatcher" on storage.objects;
drop policy if exists "payment_proofs_insert_owner_or_staff" on storage.objects;
