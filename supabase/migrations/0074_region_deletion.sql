-- The likely real cause behind "لسه مش عارف امسح منطقة" (2026-08-21):
-- Arabic doesn't distinguish "region" from "delivery zone" - both are
-- "منطقة" in casual usage, and delete already existed for delivery zones
-- (manage-delivery-zone) but never for regions (المناطق, the top-level
-- branch grouping) - there was genuinely no delete button to find here.
-- Same safe pattern as branches (0073): every FK pointing at regions.id
-- is ON DELETE NO ACTION, so a hard DELETE is safe to attempt outright.
alter table public.regions add column is_active boolean not null default true;
