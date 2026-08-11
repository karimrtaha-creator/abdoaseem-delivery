// Mandatory dispatcher-photo gate (2026-08-11 design, approved by Karim):
// an order is invisible to any driver until it has a real order_photos
// row - see the hardened orders_select_driver RLS policy (0037) and
// dispatch-order's tightened precondition. This function is the ONLY way
// that row gets created, and the ONLY way status ever advances past
// 'preparing' into 'ready_for_driver'.
//
// The photo itself is uploaded client-side directly to the `receipts`
// bucket (same pattern as branch/menu photo uploads elsewhere in this
// project - storage RLS on that bucket already scopes dispatcher writes
// to their own branch's folder, confirmed live and predating this
// feature). This function only records the resulting URL and performs
// the status transition - it never handles raw file bytes.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, isBrowserRequest } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "dispatcher") return errorResponse("only dispatcher can photograph an order", 403);
  // Same as dispatch-order - see isBrowserRequest's comment in
  // _shared/cors.ts for what this does and doesn't guarantee.
  if (isBrowserRequest(req)) {
    return errorResponse("dispatcher actions must go through the mobile app, not a browser", 403);
  }

  let body: { order_id?: number; photo_url?: string; delivery_service?: string; delivery_time_minutes?: number };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const { order_id, photo_url } = body;
  if (!order_id) return errorResponse("order_id is required");
  if (!photo_url) return errorResponse("photo_url is required - upload the photo to the receipts bucket first");

  const admin = getAdminClient();

  const withinLimit = await checkRateLimit(admin, "photograph-order", caller.id, 60, 30);
  if (!withinLimit) return errorResponse("too many requests - slow down", 429);

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, pos_order_id, branch_id, status, order_source, delivery_service, delivery_time_minutes")
    .eq("id", order_id)
    .single();
  if (orderError || !order) return errorResponse("order not found", 404);
  if (order.branch_id !== caller.branch_id) {
    return errorResponse("order does not belong to your branch", 403);
  }
  if (order.status !== "preparing") {
    return errorResponse(`order is in status '${order.status}', can only photograph an order that is 'preparing'`, 409);
  }

  // delivery_service + delivery_time_minutes (2026-08-11): a delivery
  // order can't reach the driver without a confirmed delivery time,
  // regardless of source - website orders already have both (set at
  // create-order, from the customer's zone + an SLA-tier lookup) so this
  // is just a defensive re-check; call_center orders never get them any
  // other way, so the dispatcher must supply both here, right after
  // scanning/confirming them from the printed receipt (OCR happens
  // client-side before this call - see driver_app's receipt-scan step).
  // Client-supplied values are only ever trusted for call_center - a
  // website order's values came from server-side logic at creation time
  // and are never overwritten from a client request.
  let deliveryService = order.delivery_service as string | null;
  let deliveryTimeMinutes = order.delivery_time_minutes as number | null;
  if (order.order_source === "call_center") {
    const suppliedService = body.delivery_service?.trim();
    const suppliedMinutes = body.delivery_time_minutes;
    if (!suppliedService) {
      return errorResponse("delivery_service is required for call_center orders before photographing", 422);
    }
    if (!suppliedMinutes || !Number.isFinite(suppliedMinutes) || suppliedMinutes <= 0) {
      return errorResponse("a valid delivery_time_minutes is required for call_center orders before photographing", 422);
    }
    deliveryService = suppliedService;
    deliveryTimeMinutes = Math.round(suppliedMinutes);
  } else if (!deliveryService || !deliveryTimeMinutes) {
    // Should never actually happen (create-order always sets both for
    // customer_app orders) - a real inconsistency if it does, not
    // something to silently paper over by accepting the photo anyway.
    return errorResponse("this order is missing delivery_service/delivery_time_minutes - contact support before dispatching", 500);
  }

  const { data: photoRow, error: photoError } = await admin
    .from("order_photos")
    .insert({ order_id, dispatcher_id: caller.id, photo_url })
    .select("id, photographed_at")
    .single();
  if (photoError) return errorResponse(photoError.message, 500);

  // The `.eq("status", "preparing")` guard makes this atomic against a
  // race (two dispatchers photographing the same order at once, or a
  // concurrent check-sla-breaches run) - only the first caller to land
  // here while status is still 'preparing' actually advances it.
  const { data: updatedRows, error: updateError } = await admin
    .from("orders")
    .update({
      status: "ready_for_driver",
      delivery_service: deliveryService,
      delivery_time_minutes: deliveryTimeMinutes,
    })
    .eq("id", order_id)
    .eq("status", "preparing")
    .select("id");
  if (updateError) return errorResponse(updateError.message, 500);
  if (!updatedRows || updatedRows.length === 0) {
    // The photo row above still exists and is harmless (multiple photos
    // per order are allowed by design) - just report that someone else
    // already moved this order on.
    return errorResponse("order status changed before the photo could be recorded - try again", 409);
  }

  await logAudit(admin, caller, "order_photographed", "order", order_id, {
    pos_order_id: order.pos_order_id,
    photo_id: photoRow.id,
  });

  return jsonResponse({
    order_id,
    status: "ready_for_driver",
    photo_id: photoRow.id,
    photographed_at: photoRow.photographed_at,
  });
});
