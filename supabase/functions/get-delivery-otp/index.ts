// The one place the delivery OTP is allowed to be *read back*, other than
// the SMS/WhatsApp/push send itself. Deliberately narrow:
//   - a registered customer, for their own order (section 6 customer app,
//     screen point 8: "عرض الـ OTP الخاص بيه وقت التسليم")
//   - call_center, for a guest order (customer_id is null - no app account
//     to show it in, so the agent relays it if the customer calls back)
// Nobody else - specifically not dispatcher or driver, see the removal of
// otp_code_debug from dispatch-order/resend-otp for why.
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["customer", "call_center"].includes(caller.role)) {
    return errorResponse("only the customer themselves or call_center can view the delivery code", 403);
  }

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
    .select("id, customer_id, status")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);

  if (caller.role === "customer" && order.customer_id !== caller.id) {
    return errorResponse("this is not your order", 403);
  }
  if (caller.role === "call_center" && order.customer_id !== null) {
    return errorResponse("this order belongs to a registered customer, not a guest order", 403);
  }

  if (!["out_for_delivery", "delayed"].includes(order.status)) {
    return jsonResponse({ available: false, reason: `order is in status '${order.status}'` });
  }

  const { data: otp, error: otpError } = await admin
    .from("otp_codes")
    .select("code, expires_at")
    .eq("order_id", order_id)
    .is("verified_at", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (otpError) return errorResponse(otpError.message, 500);
  if (!otp) return jsonResponse({ available: false, reason: "no active code" });

  const expired = new Date(otp.expires_at).getTime() < Date.now();
  if (expired) return jsonResponse({ available: false, reason: "expired" });

  return jsonResponse({ available: true, code: otp.code, expires_at: otp.expires_at });
});
