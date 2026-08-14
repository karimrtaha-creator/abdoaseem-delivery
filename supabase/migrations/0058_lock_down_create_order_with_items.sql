-- Security audit finding CRIT-2 (Batch 4, 2026-08-14): create_order_with_items (0056, Batch 3)
-- was created without revoking the default Postgres EXECUTE-to-PUBLIC grant every new function
-- gets unless explicitly revoked - the same class of gap 0050 already closed for check_rate_limit,
-- just never applied here. information_schema.routine_privileges confirmed it live:
-- create_order_with_items: PUBLIC:EXECUTE.
--
-- Live-confirmed exploitable: a bare curl with ONLY the public anon apikey (no Authorization
-- header, no session, no login at all) successfully called
-- POST /rest/v1/rpc/create_order_with_items and created a real order with an attacker-chosen
-- customer_id (impersonation) and unit_price (0.01 instead of the real 48.00) - complete bypass
-- of every check create-order's edge function performs (price re-fetch, MAX_ITEM_QUANTITY,
-- MAX_DELIVERY_FEE, business hours, rate limiting).
--
-- Fix: revoke EXECUTE from PUBLIC/anon/authenticated, exactly matching check_rate_limit's (0050)
-- and record_otp_wrong_attempt's (0052) posture. service_role keeps EXECUTE via 0004's blanket
-- grant + default-privileges rule, unaffected by revoking the PUBLIC-inherited grant - the
-- create-order edge function (the only legitimate caller, via its service_role admin client)
-- is unaffected. The function's atomicity implementation itself is untouched.
revoke execute on function public.create_order_with_items(
  text, bigint, uuid, text, bigint, text, text, numeric, text, integer, jsonb
) from public, anon, authenticated;
