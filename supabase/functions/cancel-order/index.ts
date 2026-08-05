// Customer self-service order cancellation (customer-web). Deliberately
// narrow: only the customer who owns the order, only while it's still
// 'pending_acceptance' (the branch hasn't started prepping yet) - once a
// branch accepts and starts cooking, cancellation needs a human
// conversation, not a button. A reason is required and stored so staff
// can see why every cancelled order was cancelled.
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";

const CANCELLABLE_STATUSES = ["pending_acceptance"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "customer") return errorResponse("only the customer who placed the order can cancel it", 403);

  let body: { order_id?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }

  const { order_id } = body;
  const reason = body.reason?.trim();
  if (!order_id) return errorResponse("order_id is required");
  if (!reason) return errorResponse("a cancellation reason is required");

  const admin = getAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, customer_id, status")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.customer_id !== caller.id) return errorResponse("this is not your order", 403);
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return errorResponse(
      "this order can no longer be cancelled - the branch has already started preparing it, call 19860",
      422,
    );
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({ status: "cancelled", cancellation_reason: reason, cancelled_by: caller.id })
    .eq("id", order_id);
  if (updateError) return errorResponse(updateError.message, 500);

  return jsonResponse({ order_id, status: "cancelled" });
});
