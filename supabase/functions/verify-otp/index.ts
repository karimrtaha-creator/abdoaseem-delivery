// Section 5, steps 6-7: driver enters the code the customer read out loud.
// Max 3 attempts; on the 3rd wrong attempt the order is flagged for manager
// follow-up via a complaint row (see complaints table) - the schema has no
// separate "delivery issue" status, so this is a deliberate reuse of the
// existing complaints mechanism rather than a new enum value.
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { minutesBetween } from "../_shared/sla.ts";

const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "driver") return errorResponse("only the assigned driver can verify OTP", 403);

  let body: { order_id?: number; code?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const { order_id, code } = body;
  if (!order_id || !code) return errorResponse("order_id and code are required");

  const admin = getAdminClient();

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, driver_id, branch_id, status, dispatch_time, sla_minutes")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.driver_id !== caller.id) return errorResponse("this order is not assigned to you", 403);
  if (!["out_for_delivery", "delayed"].includes(order.status)) {
    return errorResponse(`order is in status '${order.status}', cannot verify delivery`, 409);
  }

  const { data: otp, error: otpError } = await admin
    .from("otp_codes")
    .select("id, code, attempts, expires_at, verified_at")
    .eq("order_id", order_id)
    .is("verified_at", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (otpError) return errorResponse(otpError.message, 500);
  if (!otp) return errorResponse("no active OTP for this order - use resend-otp", 409);

  if (new Date(otp.expires_at).getTime() < Date.now()) {
    return jsonResponse({ result: "expired" }, 410);
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return jsonResponse({ result: "locked" }, 423);
  }

  if (otp.code !== code) {
    const attempts = otp.attempts + 1;
    await admin.from("otp_codes").update({ attempts }).eq("id", otp.id);

    if (attempts >= MAX_ATTEMPTS) {
      await admin.from("complaints").insert({
        order_id,
        type: "other",
        description: "فشل التحقق من كود OTP بعد 3 محاولات - مشكلة تسليم تحتاج متابعة فورية من المدير.",
      });
      return jsonResponse({ result: "locked", attempts_remaining: 0 }, 423);
    }
    return jsonResponse({ result: "wrong_code", attempts_remaining: MAX_ATTEMPTS - attempts }, 400);
  }

  const deliveredTime = new Date();
  const delayMinutes = minutesBetween(order.dispatch_time, deliveredTime) - order.sla_minutes;
  const isDelayed = delayMinutes > 0;

  const { error: updateOrderError } = await admin
    .from("orders")
    .update({
      status: "delivered",
      delivered_time: deliveredTime.toISOString(),
      delay_minutes: delayMinutes,
      is_delayed: isDelayed,
    })
    .eq("id", order_id);
  if (updateOrderError) return errorResponse(updateOrderError.message, 500);

  await admin.from("otp_codes").update({ verified_at: deliveredTime.toISOString() }).eq("id", otp.id);

  return jsonResponse({
    result: "delivered",
    order_id,
    delivered_time: deliveredTime.toISOString(),
    delay_minutes: delayMinutes,
    is_delayed: isDelayed,
  });
});
