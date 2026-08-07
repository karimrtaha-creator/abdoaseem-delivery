-- Real push notifications for drivers (new dispatch + staff cancellation of
-- an order they're already carrying) - found during a live bug report that
-- neither event notified the driver in any way, and the project had zero
-- working notification infrastructure (_shared/notify.ts is a documented
-- stub - see its own header comment). This column stores each driver's
-- current Firebase Cloud Messaging device token so an edge function can
-- push to them; no RLS change needed, users_update_self (0001) already
-- lets a user update their own row and the privilege-escalation trigger
-- only blocks role/branch_id/region_id/is_active, not this column.
alter table public.users
  add column if not exists fcm_token text;
