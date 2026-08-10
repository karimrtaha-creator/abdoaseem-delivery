-- "المندوب قريب منك" push to the customer - see check-driver-proximity.
-- One-shot per order (not "every time the driver is close", just the
-- first time), which is what this flag is for.
alter table public.orders
  add column if not exists proximity_alert_sent boolean not null default false;
