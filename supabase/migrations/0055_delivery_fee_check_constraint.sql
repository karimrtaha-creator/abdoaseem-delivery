-- Security audit finding F-03 (pre-commit review, 2026-08-14): the
-- MAX_DELIVERY_FEE cap added in manage-delivery-zone/index.ts and
-- update-branch-delivery-fee/index.ts only exists in application code.
-- Confirmed live: `authenticated` has direct INSERT/UPDATE grants on both
-- branches and delivery_zones (delivery_zones_write_general_manager /
-- branches_write_general_manager only restrict WHO by role, never WHAT
-- value) - a general_manager/team_leader could set an absurd fee by
-- calling PostgREST directly instead of going through the edge function.
--
-- Both columns are `numeric not null` (confirmed via information_schema
-- before writing this) - no NULL is ever valid today, so no NULL-
-- tolerant clause is needed in either constraint. Pre-migration data
-- check found zero violations: all 13 branches are at 0, all 644
-- delivery_zones range 10-70 - comfortably inside 0-500.
--
-- The bound (500) matches MAX_DELIVERY_FEE exactly (kept in sync
-- manually - there are only two application-layer copies of that
-- constant, per their own comments, so this is one more place, not a
-- new source of truth). This is a backstop, not a replacement for the
-- edge function checks: the edge functions still own the actual error
-- message a legitimate caller sees; this constraint only fires if that
-- layer is bypassed entirely.
alter table public.branches
  add constraint branches_delivery_fee_range check (delivery_fee >= 0 and delivery_fee <= 500);

alter table public.delivery_zones
  add constraint delivery_zones_delivery_fee_range check (delivery_fee >= 0 and delivery_fee <= 500);
