// Order cancellation - two distinct paths sharing one function since both
// end at the same "stamp cancelled + reason" update:
//   1. Customer self-service (customer-web): only their own order, only
//      while it's still 'pending_acceptance' - once a branch accepts and
//      starts cooking, cancellation needs a human conversation, not a
//      customer-facing button.
//   2. Staff (team_leader/general_manager, from AcceptanceLobby.tsx):
//      cancelling an order that's *already* been accepted (preparing/
//      out_for_delivery/delayed) - e.g. the branch ran out of an
//      ingredient, or the driver had an accident. Requires a reason for
//      the same audit-trail purpose. Not for pending_acceptance orders -
//      that's what accept-order's "reject" action is for.
// A reason is required on both paths and stored so anyone reviewing the
// order later can see exactly why it was cancelled.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { sendPush } from "../_shared/fcm.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { logAudit } from "../_shared/audit.ts";

const CUSTOMER_CANCELLABLE_STATUSES = ["pending_acceptance"];
// 'ready_for_driver' added 2026-08-11 (mandatory photo-gate feature) -
// without it, a photographed-but-unassigned order would be cancellable
// neither as 'preparing' nor via any other status in this list.
const STAFF_CANCELLABLE_STATUSES = ["preparing", "ready_for_driver", "out_for_delivery", "delayed"];
const STAFF_CANCEL_ROLES = ["team_leader", "general_manager"];

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  const isStaff = STAFF_CANCEL_ROLES.includes(caller.role);
  if (caller.role !== "customer" && !isStaff) {
    return errorResponse("only the customer who placed the order, or a team_leader/general_manager, can cancel it", 403);
  }

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

  // Finding #001: 20/minute - covers both paths sharing this function
  // (an occasional customer self-cancel, or staff clearing several
  // problem orders in a busy stretch) without opening the door to an
  // automated cancellation flood.
  const withinLimit = await checkRateLimit(admin, "cancel-order", caller.id, 60, 20);
  if (!withinLimit) return errorResponse("too many requests - slow down", 429);

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, pos_order_id, customer_id, status, driver_id")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);

  if (isStaff) {
    if (!STAFF_CANCELLABLE_STATUSES.includes(order.status)) {
      return errorResponse(
        `this order is in status '${order.status}' - staff cancellation only applies after acceptance (preparing/out_for_delivery/delayed); use accept-order's reject action for a still-pending order`,
        422,
      );
    }
  } else {
    if (order.customer_id !== caller.id) return errorResponse("this is not your order", 403);
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
      return errorResponse(
        "this order can no longer be cancelled - the branch has already started preparing it, call 19860",
        422,
      );
    }
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({ status: "cancelled", cancellation_reason: reason, cancelled_by: caller.id })
    .eq("id", order_id);
  if (updateError) return errorResponse(updateError.message, 500);

  await logAudit(admin, caller, "order_cancelled", "order", order_id, {
    pos_order_id: order.pos_order_id,
    reason,
    cancelled_by_role: caller.role,
  });

  // Only ever set once dispatch-order assigns a driver - a still-'preparing'
  // order that gets cancelled never had a driver involved, nothing to alert.
  if (order.driver_id) {
    const { data: driver } = await admin.from("users").select("fcm_token").eq("id", order.driver_id).single();
    if (driver?.fcm_token) {
      await sendPush(
        driver.fcm_token,
        "أوردر اتلغى",
        `أوردر #${order.pos_order_id ?? order.id} اتلغى - ${reason}. متكملش توصيله.`,
        { order_id: String(order_id), type: "cancelled" },
      );
    }
  }

  return jsonResponse({ order_id, status: "cancelled" });
});
