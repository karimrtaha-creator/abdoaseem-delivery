// Section 4: "عند مراجعة الأوردر من تيم ليدر/هيد مانجر" - the acceptance
// gate every order (call_center / customer_app) passes through before
// entering `preparing`. POS orders (Phase 5, auto-accept per section 6
// note) are out of scope here.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { sendPush } from "../_shared/fcm.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { logAudit } from "../_shared/audit.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  // "Agent" (call_center role, 2026-08-11) can accept/reject too, but only
  // website orders - see the order_source check below. Their own
  // phone-order-taking duty is unaffected; they've never self-accepted
  // those, team_leader/general_manager still do.
  if (!["team_leader", "general_manager", "call_center"].includes(caller.role)) {
    return errorResponse("only team_leader, general_manager, or call_center can accept/reject orders", 403);
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
    .select("id, pos_order_id, status, payment_method, payment_proof_url, customer_id, order_source")
    .eq("id", order_id)
    .single();

  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.status !== "pending_acceptance") {
    return errorResponse(`order is in status '${order.status}', not 'pending_acceptance'`, 409);
  }
  if (caller.role === "call_center" && order.order_source !== "customer_app") {
    return errorResponse("call_center can only accept/reject website orders", 403);
  }

  if (action === "reject") {
    // Guarded on the status this read above found, not just the id - the
    // same race a concurrent caller (another team_leader/GM/call_center
    // agent) could win between this read and this write. Only the first
    // caller to land here while status is still 'pending_acceptance'
    // actually transitions it; a second caller sees zero rows affected
    // and gets a real 409 instead of a false-positive "rejected".
    const { data: updatedRows, error: updateError } = await admin
      .from("orders")
      .update({ status: "rejected" })
      .eq("id", order_id)
      .eq("status", "pending_acceptance")
      .select("id");
    if (updateError) return dbErrorResponse("accept-order", updateError.message);
    if (!updatedRows || updatedRows.length === 0) {
      return errorResponse("order status changed before it could be rejected - someone else already acted on it", 409);
    }
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

  // Same guarded-update race protection as the reject branch above.
  const { data: updatedRows, error: updateError } = await admin
    .from("orders")
    .update({
      status: "preparing",
      accepted_by: caller.id,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", order_id)
    .eq("status", "pending_acceptance")
    .select("id");

  if (updateError) return dbErrorResponse("accept-order", updateError.message);
  if (!updatedRows || updatedRows.length === 0) {
    return errorResponse("order status changed before it could be accepted - someone else already acted on it", 409);
  }

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
