// Section 4 / 6: the dispatcher's "تأكيد الخروج" action. Computes
// prep_time_minutes and sla_minutes, stamps dispatch_time with the
// function's own clock (server time, never a client-supplied timestamp),
// generates the delivery OTP, and moves the order to out_for_delivery.
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { lookupSlaMinutes, minutesBetween, generateOtpCode } from "../_shared/sla.ts";
import { sendOtpToCustomer } from "../_shared/notify.ts";

const OTP_VALIDITY_MINUTES = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "dispatcher") return errorResponse("only dispatcher can dispatch orders", 403);

  let body: {
    order_id?: number;
    driver_id?: string;
    delivery_fee_after_tax?: number;
    receipt_photo_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const { order_id, driver_id, delivery_fee_after_tax, receipt_photo_url } = body;
  if (!order_id || !driver_id || delivery_fee_after_tax == null) {
    return errorResponse("order_id, driver_id and delivery_fee_after_tax are all required");
  }
  if (delivery_fee_after_tax <= 0) return errorResponse("delivery_fee_after_tax must be > 0");

  const admin = getAdminClient();

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, branch_id, status, accepted_at, customer_phone")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.branch_id !== caller.branch_id) {
    return errorResponse("order does not belong to your branch", 403);
  }
  if (order.status !== "preparing") {
    return errorResponse(`order is in status '${order.status}', not 'preparing'`, 409);
  }

  const { data: driver, error: driverError } = await admin
    .from("users")
    .select("id, role, branch_id, is_active")
    .eq("id", driver_id)
    .single();
  if (driverError || !driver) return errorResponse("driver not found", 404);
  if (driver.role !== "driver" || driver.branch_id !== caller.branch_id || !driver.is_active) {
    return errorResponse("driver_id is not an active driver assigned to your branch", 422);
  }

  const slaMinutes = await lookupSlaMinutes(admin, delivery_fee_after_tax);
  const dispatchTime = new Date();
  const prepTimeMinutes = minutesBetween(order.accepted_at, dispatchTime);

  const { error: updateError } = await admin
    .from("orders")
    .update({
      driver_id,
      dispatcher_id: caller.id,
      dispatch_time: dispatchTime.toISOString(),
      prep_time_minutes: prepTimeMinutes,
      delivery_fee_after_tax,
      receipt_photo_url,
      sla_minutes: slaMinutes,
      status: "out_for_delivery",
    })
    .eq("id", order_id);
  if (updateError) return errorResponse(updateError.message, 500);

  const code = generateOtpCode();
  const expiresAt = new Date(dispatchTime.getTime() + OTP_VALIDITY_MINUTES * 60_000);
  const { error: otpError } = await admin
    .from("otp_codes")
    .insert({ order_id, code, expires_at: expiresAt.toISOString() });
  if (otpError) return errorResponse(`order dispatched but OTP creation failed: ${otpError.message}`, 500);

  const sendResult = await sendOtpToCustomer(order.customer_phone, code, order_id);

  // The dispatcher has no legitimate reason to see the delivery code - it
  // exists to verify the driver actually reached the customer, so it never
  // appears in this response or in apps/dispatcher-web under any
  // circumstance. To view it, use get-delivery-otp from the customer's own
  // order-tracking screen, or from the call_center screen for guest orders.
  return jsonResponse({
    order_id,
    status: "out_for_delivery",
    dispatch_time: dispatchTime.toISOString(),
    prep_time_minutes: prepTimeMinutes,
    sla_minutes: slaMinutes,
    otp_channel: sendResult.channel,
  });
});
