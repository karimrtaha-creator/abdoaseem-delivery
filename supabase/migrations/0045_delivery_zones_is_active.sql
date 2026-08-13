-- Karim's correction (2026-08-13): delivery_zones (per-branch, per-zone
-- pricing) is confirmed as the real business model - branches.delivery_fee
-- is only ever a fallback for addresses/orders with no zone_id, not the
-- primary pricing mechanism. This adds the one thing the existing
-- delivery_zones schema was missing to support the requested admin UI
-- (enable/disable a zone, and a safe soft-delete fallback when a zone is
-- still referenced by real customer_addresses/order history and can't be
-- hard-deleted). Defaults every existing zone (including all 644 real
-- imported rows) to active - this is additive, not a behavior change for
-- any zone that isn't explicitly disabled going forward.
alter table public.delivery_zones
  add column is_active boolean not null default true;
