// Section 5 exceptions table: "إعادة إرسال الكود" - used when the code
// expired before the driver arrived, or delivery failed to reach the
// customer. Issues a fresh code/expiry as a new otp_codes row (so it starts
// with attempts = 0) rather than mutating the old one.
//
// Capped at MAX_RESENDS per order (on top of the one code dispatch-order
// already issued) - without this, resend fully undoes verify-otp's
// attempt lock: resetting attempts to 0 on demand means unlimited guesses
// in batches of MAX_ATTEMPTS. See verify-otp/index.ts for why business
// outcomes here also return HTTP 200 + a `result` field.
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { generateOtpCode } from "../_shared/sla.ts";
import { sendOtpToCustomer } from "../_shared/notify.ts";

const OTP_VALIDITY_MINUTES = 20;
const MAX_RESENDS = 3; // + the 1 code from dispatch-order = 4 codes/order max

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "driver") return errorResponse("only the assigned driver can resend OTP", 403);

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
    .select("id, driver_id, status, customer_phone")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.driver_id !== caller.id) return errorResponse("this order is not assigned to you", 403);
  if (!["out_for_delivery", "delayed"].includes(order.status)) {
    return errorResponse(`order is in status '${order.status}', cannot resend OTP`, 409);
  }

  const { count: codesSoFar, error: countError } = await admin
    .from("otp_codes")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order_id);
  if (countError) return errorResponse(countError.message, 500);

  if ((codesSoFar ?? 0) > MAX_RESENDS) {
    // Log only, not a complaints row - see the matching note in
    // verify-otp/index.ts: no screen reads that table yet.
    console.warn(`order ${order_id}: resend limit (${MAX_RESENDS}) reached (driver ${caller.id})`);
    return jsonResponse({ result: "resend_limit_reached" });
  }

  // Invalidate any still-open code so only the newest one can ever verify.
  await admin
    .from("otp_codes")
    .update({ verified_at: new Date().toISOString() })
    .eq("order_id", order_id)
    .is("verified_at", null);

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_VALIDITY_MINUTES * 60_000);
  const { data: freshRow, error: insertError } = await admin
    .from("otp_codes")
    .insert({ order_id, code, expires_at: expiresAt.toISOString() })
    .select("id")
    .single();
  if (insertError) return errorResponse(insertError.message, 500);

  const sendResult = await sendOtpToCustomer(order.customer_phone, code, order_id);

  // The code itself is never returned here on purpose - the driver calls
  // this endpoint and must keep asking the customer verbally. To see the
  // code, use get-delivery-otp (customer's own order-tracking screen, or
  // call_center for guest/call-center orders) - see supabase/functions/get-delivery-otp.
  return jsonResponse({
    result: "resent",
    order_id,
    otp_id: freshRow?.id,
    expires_at: expiresAt.toISOString(),
    otp_channel: sendResult.channel,
  });
});
