// Replaces the old OTP-code exchange (see removed verify-otp) - the
// driver taps a single "delivered" confirmation once they've physically
// handed the order over, no code read out loud by the customer anymore.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { minutesBetween } from "../_shared/sla.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "driver") return errorResponse("only the assigned driver can confirm delivery", 403);

  let body: { order_id?: number };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const { order_id } = body;
  if (!order_id) return errorResponse("order_id is required");

  const admin = getAdminClient();

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, driver_id, status, dispatch_time, sla_minutes")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.driver_id !== caller.id) return errorResponse("this order is not assigned to you", 403);

  const deliveredTime = new Date();
  const delayMinutes = minutesBetween(order.dispatch_time, deliveredTime) - order.sla_minutes;
  const isDelayed = delayMinutes > 0;

  // Guarded on the same status check above (same pattern already used by
  // accept-order/dispatch-order/cancel-order): only a caller whose UPDATE
  // actually matches a row wins, so a double-tap or a concurrent request
  // can't mark the same order delivered twice.
  const { data: updatedRows, error: updateError } = await admin
    .from("orders")
    .update({
      status: "delivered",
      delivered_time: deliveredTime.toISOString(),
      delay_minutes: delayMinutes,
      is_delayed: isDelayed,
    })
    .eq("id", order_id)
    .eq("driver_id", caller.id)
    .in("status", ["out_for_delivery", "delayed"])
    .select("id");
  if (updateError) return dbErrorResponse("confirm-delivery", updateError.message);
  if (!updatedRows || updatedRows.length === 0) {
    return errorResponse(`order is in status '${order.status}', cannot confirm delivery`, 409);
  }

  return jsonResponse({
    result: "delivered",
    order_id,
    delivered_time: deliveredTime.toISOString(),
    delay_minutes: delayMinutes,
    is_delayed: isDelayed,
  });
});
