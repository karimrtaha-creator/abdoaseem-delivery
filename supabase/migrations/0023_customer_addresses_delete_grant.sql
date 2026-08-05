-- Bug found during a systematic grant audit: 0005 wrote a "for all"
-- (select/insert/update/delete) RLS policy for a customer managing their
-- own addresses, but only ever GRANTed select/insert/update - never
-- delete. A Postgres GRANT is what makes an operation possible at all;
-- the RLS policy only narrows which rows once the operation is allowed -
-- so every "حذف" (delete) click on Addresses.tsx has been failing with a
-- permission-denied error since this table was created, for every real
-- customer, the entire time. Confirmed live before this fix (403,
-- "permission denied for table customer_addresses").

grant delete on public.customer_addresses to authenticated;
