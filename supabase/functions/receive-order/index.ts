// Driver app redesign: the "استلام الطلب" step that never existed before -
// dispatch-order (dispatcher-side) sets driver_id + status='out_for_delivery'
// in one move with no driver-side acknowledgement in between. This function
// is that missing step, and it's the actual enforcement point (not the
// Flutter UI) for two rules Karim asked for:
//   1. Customer PII stays hidden (see the new list_my_driver_orders /
//      get_my_driver_order RPCs, both keyed on driver_received_at) until an
//      order has genuinely been marked received here.
//   2. A driver can never end up with "received > loaded" - the UPDATE
//      below is scoped to exactly the order ids passed in AND driver_id =
//      caller AND status still out_for_delivery/delayed AND
//      driver_received_at still null, so an id that's already received, not
//      theirs, or in the wrong status simply doesn't get touched - there is
//      no way to receive the same order twice or receive an order that was
//      never assigned to this driver, no matter what the client sends.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { logAudit } from "../_shared/audit.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "driver") return errorResponse("only a driver can receive orders", 403);

  let body: { order_ids?: number[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const orderIds = body.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return errorResponse("order_ids must be a non-empty array");
  }
  if (!orderIds.every((id) => Number.isInteger(id) && id > 0)) {
    return errorResponse("order_ids must all be positive integers");
  }

  const admin = getAdminClient();

  const withinLimit = await checkRateLimit(admin, "receive-order", caller.id, 60, 30);
  if (!withinLimit) return errorResponse("too many requests - slow down", 429);

  const { data: receivedRows, error: updateError } = await admin
    .from("orders")
    .update({ driver_received_at: new Date().toISOString() })
    .in("id", orderIds)
    .eq("driver_id", caller.id)
    .in("status", ["out_for_delivery", "delayed"])
    .is("driver_received_at", null)
    .select("id");
  if (updateError) return dbErrorResponse("receive-order", updateError.message);

  const received = (receivedRows ?? []).map((r) => r.id as number);
  const notReceived = orderIds.filter((id) => !received.includes(id));

  if (received.length > 0) {
    await logAudit(admin, caller, "orders_received", "order", received.join(","), {
      order_ids: received,
    });
  }

  return jsonResponse({ received, not_received: notReceived });
});
