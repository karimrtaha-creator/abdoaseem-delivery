// Section 4: "عند مراجعة الأوردر من تيم ليدر/هيد مانجر" - the acceptance
// gate every order (call_center / customer_app) passes through before
// entering `preparing`. POS orders (Phase 5, auto-accept per section 6
// note) are out of scope here.
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";

Deno.serve(async (req) => {
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
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, status, payment_method, payment_proof_url")
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
  return jsonResponse({ order_id, status: "preparing" });
});
