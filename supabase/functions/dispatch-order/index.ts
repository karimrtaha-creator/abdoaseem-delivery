// Section 4 / 6: the dispatcher's "تأكيد الخروج" action. Computes
// prep_time_minutes and sla_minutes, stamps dispatch_time with the
// function's own clock (server time, never a client-supplied timestamp),
// generates the delivery OTP, and moves the order to out_for_delivery.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, isBrowserRequest, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { lookupSlaMinutes, minutesBetween, generateOtpCode } from "../_shared/sla.ts";
import { sendOtpToCustomer } from "../_shared/notify.ts";
import { sendPush } from "../_shared/fcm.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { logAudit } from "../_shared/audit.ts";

const OTP_VALIDITY_MINUTES = 20;

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "dispatcher") return errorResponse("only dispatcher can dispatch orders", 403);
  // Karim's explicit instruction: dispatcher's whole job lives in the
  // mobile app now, never dispatcher-web - see isBrowserRequest's comment
  // in _shared/cors.ts for what this does and doesn't guarantee.
  if (isBrowserRequest(req)) {
    return errorResponse("dispatcher actions must go through the mobile app, not a browser", 403);
  }

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

  // Finding #001: same 30/minute budget as accept-order.
  const withinLimit = await checkRateLimit(admin, "dispatch-order", caller.id, 60, 30);
  if (!withinLimit) return errorResponse("too many requests - slow down", 429);

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, pos_order_id, branch_id, status, dispatch_time, accepted_at, customer_phone, customer_id")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.branch_id !== caller.branch_id) {
    return errorResponse("order does not belong to your branch", 403);
  }
  // Mandatory dispatcher-photo gate (2026-08-11): 'ready_for_driver' is
  // only ever reached via photograph-order, so checking for it here would
  // normally be enough on its own - EXCEPT 'delayed' can also be reached
  // straight from 'preparing' (check-sla-breaches flips a forgotten,
  // never-photographed order to 'delayed' too), and that path must NOT be
  // allowed to skip the photo. So the real gate is "does a photo actually
  // exist for this order", checked directly - not inferred from status
  // alone. An already-dispatched order that later ran late is also
  // 'delayed' but has a dispatch_time set, and must never be re-dispatched
  // through this path either way.
  const statusAllowsDispatch = order.status === "ready_for_driver" || (order.status === "delayed" && !order.dispatch_time);
  if (!statusAllowsDispatch) {
    return errorResponse(`order is in status '${order.status}', not awaiting dispatch`, 409);
  }
  if (order.status === "delayed") {
    const { count: photoCount } = await admin
      .from("order_photos")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order_id);
    if (!photoCount || photoCount === 0) {
      return errorResponse("this order has not been photographed by a dispatcher yet - photograph it before dispatching", 409);
    }
  }

  const { data: driver, error: driverError } = await admin
    .from("users")
    .select("id, name, role, branch_id, is_active, fcm_token")
    .eq("id", driver_id)
    .single();
  if (driverError || !driver) return errorResponse("driver not found", 404);
  if (driver.role !== "driver" || driver.branch_id !== caller.branch_id || !driver.is_active) {
    return errorResponse("driver_id is not an active driver assigned to your branch", 422);
  }

  const slaMinutes = await lookupSlaMinutes(admin, delivery_fee_after_tax, order.branch_id);
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
  if (updateError) return dbErrorResponse("dispatch-order", updateError.message);

  await logAudit(admin, caller, "order_dispatched", "order", order_id, {
    pos_order_id: order.pos_order_id,
    driver_id,
  });

  const code = generateOtpCode();
  const expiresAt = new Date(dispatchTime.getTime() + OTP_VALIDITY_MINUTES * 60_000);
  const { error: otpError } = await admin
    .from("otp_codes")
    .insert({ order_id, code, expires_at: expiresAt.toISOString() });
  if (otpError) return errorResponse(`order dispatched but OTP creation failed: ${otpError.message}`, 500);

  const sendResult = await sendOtpToCustomer(order.customer_phone, code, order_id);

  if (driver.fcm_token) {
    await sendPush(
      driver.fcm_token,
      "أوردر جديد للتوصيل",
      `أوردر #${order.pos_order_id ?? order.id} جاهز يتسلّم منك دلوقتي.`,
      { order_id: String(order_id), type: "new_dispatch" },
    );
  }

  const { data: customer } = await admin.from("users").select("fcm_token").eq("id", order.customer_id).single();
  if (customer?.fcm_token) {
    const webUrl = Deno.env.get("CUSTOMER_WEB_URL");
    await sendPush(
      customer.fcm_token,
      "الأوردر في الطريق",
      `المندوب ${driver.name} خارج لتوصيل أوردر #${order.pos_order_id ?? order.id} دلوقتي.`,
      { order_id: String(order_id), type: "dispatched" },
      webUrl ? `${webUrl}/orders` : undefined,
    );
  }

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
