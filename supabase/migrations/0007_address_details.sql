-- Extends customer_addresses with the fields the customer-facing address
-- form actually needs (spec section 6 didn't enumerate these - captured
-- directly from the project owner): street name, a landmark, a formal
-- "main region" (the same regions row used everywhere else in the system,
-- e.g. "منطقة المعادي" - the pre-existing `area` free-text column is kept
-- as-is for an optional extra neighborhood note, it is NOT what the owner
-- meant by "المنطقة الرئيسية"), and an alternate contact number with its
-- own "does this have WhatsApp" flag (feeds the section 5 channel-priority
-- logic later). The customer's own geolocation pin at address-creation
-- time reuses the existing latitude/longitude columns from 0005 (already
-- there for the driver's "save location" button) - no new columns needed
-- for that.
--
-- No RLS changes needed: customer_addresses_select_self /
-- customer_addresses_write_self (0005) already let a customer manage their
-- own rows, and these are just additional columns on the same table.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) and guarded so it's a no-op if
-- 0005 was never applied.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'customer_addresses') then
    alter table public.customer_addresses
      add column if not exists street text,
      add column if not exists landmark text,
      add column if not exists main_region_id int references public.regions(id),
      add column if not exists alt_phone text,
      add column if not exists alt_phone_has_whatsapp boolean not null default false;
  end if;
end $$;
