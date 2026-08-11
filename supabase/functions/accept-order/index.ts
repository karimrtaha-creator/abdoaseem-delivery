// Section 4: "عند مراجعة الأوردر من تيم ليدر/هيد مانجر" - the acceptance
// gate every order (call_center / customer_app) passes through before
// entering `preparing`. POS orders (Phase 5, auto-accept per section 6
// note) are out of scope here.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { sendPush } from "../_shared/fcm.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { logAudit } from "../_shared/audit.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["team_leader", "general_manager"].includes(caller.role)) {
    return errorResponse("only team_leader or general_manager can accept/reject orders", 403);
  }

  let body: { order_id?: number; action?: "accept" | "reject" };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const { order_id, action } = body;
  if (!order_id || !["accept", "reject"].includes(action ?? "")) {
    return errorResponse("order_id and action ('accept'|'reject') are required");
  }

  const admin = getAdminClient();

  // Finding #001: 30 / minute - generous for a team_leader clicking
  // through a real backlog of pending orders quickly, tight enough to
  // stop an automated flood of accept/reject calls.
  const withinLimit = await checkRateLimit(admin, "accept-order", caller.id, 60, 30);
  if (!withinLimit) return errorResponse("too many requests - slow down", 429);

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, pos_order_id, status, payment_method, payment_proof_url, customer_id")
    .eq("id", order_id)
    .single();

  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.status !== "pending_acceptance") {
    return errorResponse(`order is in status '${order.status}', not 'pending_acceptance'`, 409);
  }

  if (action === "reject") {
    const { error: updateError } = await admin
      .from("orders")
      .update({ status: "rejected" })
      .eq("id", order_id);
    if (updateError) return errorResponse(updateError.message, 500);
    await logAudit(admin, caller, "order_rejected", "order", order_id, { pos_order_id: order.pos_order_id });
    return jsonResponse({ order_id, status: "rejected" });
  }

  // action === "accept"
  if (order.payment_method === "instapay_transfer" && !order.payment_proof_url) {
    return errorResponse(
      "cannot accept: instapay_transfer order has no payment_proof_url to verify",
      422,
    );
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({
      status: "preparing",
      accepted_by: caller.id,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", order_id);

  if (updateError) return errorResponse(updateError.message, 500);

  await logAudit(admin, caller, "order_accepted", "order", order_id, { pos_order_id: order.pos_order_id });

  const { data: customer } = await admin.from("users").select("fcm_token").eq("id", order.customer_id).single();
  if (customer?.fcm_token) {
    const webUrl = Deno.env.get("CUSTOMER_WEB_URL");
    await sendPush(
      customer.fcm_token,
      "الأوردر اتقبل",
      `أوردر #${order.pos_order_id ?? order.id} جاري تحضيره دلوقتي.`,
      { order_id: String(order_id), type: "accepted" },
      webUrl ? `${webUrl}/orders` : undefined,
    );
  }

  return jsonResponse({ order_id, status: "preparing" });
});
