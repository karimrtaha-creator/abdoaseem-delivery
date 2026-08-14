// Section 5, steps 6-7: driver enters the code the customer read out loud.
// Max 5 attempts; on the 5th wrong attempt the order is flagged for manager
// follow-up via a complaint row (see complaints table) - the schema has no
// separate "delivery issue" status, so this is a deliberate reuse of the
// existing complaints mechanism rather than a new enum value.
//
// Every *expected* outcome (right code, wrong code, expired, locked, no
// active code) returns HTTP 200 with a `result` field - these are normal
// business responses to a verify attempt, not transport errors. A client
// SDK that throws on non-2xx (e.g. supabase_flutter's functions.invoke)
// would otherwise never see this payload for anything but success, which
// is exactly what silently broke the driver app's lock/expiry messaging
// before this fix. Real HTTP error codes are reserved for genuine
// exceptions: 401 unauthorized, 403 wrong role/not your order, 404 order
// not found, 409 wrong order status, 500 server error.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { minutesBetween } from "../_shared/sla.ts";

const MAX_ATTEMPTS = 5;

serveWithCors(async (req) => {
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
  if (otpError) return dbErrorResponse("verify-otp", otpError.message);
  if (!otp) return jsonResponse({ result: "no_active_code" });

  if (new Date(otp.expires_at).getTime() < Date.now()) {
    return jsonResponse({ result: "expired" });
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return jsonResponse({ result: "locked" });
  }

  if (otp.code !== code) {
    // Atomic (security audit finding L-01, 0052): a single guarded
    // UPDATE inside record_otp_wrong_attempt, not a stale read-then-write
    // - concurrent wrong guesses on the same row serialize on Postgres's
    // row lock instead of racing, so attempts can neither be lost nor
    // pushed past MAX_ATTEMPTS.
    const { data: newAttempts, error: attemptError } = await admin.rpc("record_otp_wrong_attempt", {
      p_otp_id: otp.id,
      p_max_attempts: MAX_ATTEMPTS,
    });
    if (attemptError) return dbErrorResponse("verify-otp", attemptError.message);

    // null means the guarded UPDATE matched zero rows - a concurrent
    // request already pushed this row to attempts >= MAX_ATTEMPTS (or
    // verified it) between our read above and this call. Either way the
    // safe answer is "locked", never a freshly-computed attempts count.
    if (newAttempts == null) {
      return jsonResponse({ result: "locked", attempts_remaining: 0 });
    }

    if (newAttempts >= MAX_ATTEMPTS) {
      // Not written to complaints: that table has no viewing screen yet
      // anywhere in this project, so a silent DB write nobody can see is
      // worse than a log line a developer can actually go find. Revisit
      // once the complaints screen (spec section 6, manager dashboard) exists.
      console.warn(
        `order ${order_id}: OTP verification locked after ${MAX_ATTEMPTS} failed attempts (driver ${caller.id})`,
      );
      return jsonResponse({ result: "locked", attempts_remaining: 0 });
    }
    // Never echo the submitted code or anything about the real one - only
    // a remaining-attempts count, nothing that narrows down a guess.
    return jsonResponse({ result: "wrong_code", attempts_remaining: MAX_ATTEMPTS - newAttempts });
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
  if (updateOrderError) return dbErrorResponse("verify-otp", updateOrderError.message);

  await admin.from("otp_codes").update({ verified_at: deliveredTime.toISOString() }).eq("id", otp.id);

  return jsonResponse({
    result: "delivered",
    order_id,
    delivered_time: deliveredTime.toISOString(),
    delay_minutes: delayMinutes,
    is_delayed: isDelayed,
  });
});
