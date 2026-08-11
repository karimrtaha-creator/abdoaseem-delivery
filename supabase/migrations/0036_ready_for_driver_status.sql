-- Mandatory dispatcher-photo gate (2026-08-11 design, approved): a new
-- status sitting between 'preparing' (kitchen working it) and
-- 'out_for_delivery' (driver assigned + moving) - only reachable via a
-- successful photo, never skippable. Separate migration file because
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as its
-- first use (the next migration references it).
alter type public.order_status add value 'ready_for_driver' after 'preparing';
