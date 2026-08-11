-- Karim's requirement (2026-08-11, follow-up to the dispatcher-photo-gate
-- feature): every delivery order should end up with the same shape,
-- regardless of source - delivery_service + delivery_time + receipt_photo
-- + dispatcher + assigned_driver. receipt_photo/dispatcher/assigned_driver
-- already exist (order_photos.dispatcher_id, orders.driver_id) - these two
-- are new.
--
-- Website orders: populated automatically at create-order time from the
-- customer's selected delivery zone + the same SLA-tier lookup
-- dispatch-order already uses (see create-order/index.ts).
-- Call-center orders: populated at photograph-order time, confirmed/
-- entered by the dispatcher after an on-device OCR pass on the printed
-- receipt (see photograph-order/index.ts and driver_app's OCR step) -
-- null until then, and photograph-order refuses to advance a call_center
-- order past 'preparing' without both fields set.
alter table public.orders
  add column delivery_service text,
  add column delivery_time_minutes integer;
