// Section 4: "لو الطيار عدّى الـ SLA وهو لسه في الطريق... السيستم يبعت
// إشعار للمدير فورًا". Meant to run on a schedule (e.g. every 1-2 minutes
// via Supabase Cron / pg_cron+pg_net calling this function's URL) rather
// than being invoked by a client. Flips orders that have blown their SLA
// to status='delayed' (closest existing enum value to a live "breached"
// flag) and alerts managers once per breach - it will not re-alert an
// order already marked delayed.
//
// Three independent legs get checked, not just one:
//   1. dispatch -> delivery (the original check): out_for_delivery orders
//      whose dispatch_time + sla_minutes has passed.
//   2. acceptance -> dispatch (added after a live bug report): an order
//      that's been sitting in 'preparing' for too long because the
//      dispatcher never actually dispatched it. Before this, the ONLY
//      thing that ever caught this was a sound alarm in Dispatch.tsx that
//      only fires if a dispatcher happens to have that browser tab open
//      live - server-side, nothing ever flagged it, so it just sat in the
//      "ongoing" count forever and never became "delayed" for anyone
//      (general_manager included) to notice on the dashboard.
//   3. photographed -> assigned (added with the mandatory photo-gate
//      feature, 2026-08-11): an order that's been sitting in
//      'ready_for_driver' too long because no dispatcher assigned a
//      driver yet. Same gap as #2 would otherwise exist here too - the
//      order is physically ready and photographed, just never handed off.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/auth.ts";
import { alertManagersOrderDelayed } from "../_shared/notify.ts";

// Same threshold Dispatch.tsx already uses client-side for its sound
// alarm (PREP_ALERT_THRESHOLD_MINUTES) - no prep-time SLA is defined
// anywhere in the spec, this is just "long enough that someone forgot it".
const PREP_ALERT_THRESHOLD_MINUTES = 10;

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // This function has no per-user role to check (it's meant to run
  // unattended on a schedule, not be called by a signed-in staff member),
  // so it's gated the way Supabase's own docs recommend for cron-only
  // functions: only a request presenting a known secret can invoke it.
  // Found during an audit with no auth check at all: any anonymous caller
  // with just the public anon key could trigger it and see internal order
  // counts. Accepts either the service_role key or a dedicated CRON_SECRET
  // (what the actual pg_cron job - see migration 0022 - is configured
  // with, via Vault, so the real service_role key never has to be pasted
  // into a cron job definition that's visible in the cron.job table).
  const authHeader = req.headers.get("Authorization") ?? "";
  const presentedToken = authHeader.replace(/^Bearer\s+/i, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authorized =
    (!!serviceRoleKey && presentedToken === serviceRoleKey) || (!!cronSecret && presentedToken === cronSecret);
  if (!authorized) {
    return errorResponse("unauthorized", 401);
  }

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  const [dispatchedRes, preparingRes, readyForDriverRes] = await Promise.all([
    admin
      .from("orders")
      .select("id, branch_id, dispatch_time, sla_minutes")
      .eq("status", "out_for_delivery")
      .not("dispatch_time", "is", null),
    admin.from("orders").select("id, branch_id, accepted_at").eq("status", "preparing").not("accepted_at", "is", null),
    admin
      .from("orders")
      .select("id, branch_id, order_photos(photographed_at)")
      .eq("status", "ready_for_driver"),
  ]);
  if (dispatchedRes.error) return dbErrorResponse("check-sla-breaches", dispatchedRes.error.message);
  if (preparingRes.error) return dbErrorResponse("check-sla-breaches", preparingRes.error.message);
  if (readyForDriverRes.error) return dbErrorResponse("check-sla-breaches", readyForDriverRes.error.message);

  const breachedDispatched = (dispatchedRes.data ?? []).filter((o) => {
    const deadline = new Date(o.dispatch_time).getTime() + o.sla_minutes * 60_000;
    return deadline < Date.now();
  });
  const breachedPreparing = (preparingRes.data ?? []).filter((o) => {
    const deadline = new Date(o.accepted_at).getTime() + PREP_ALERT_THRESHOLD_MINUTES * 60_000;
    return deadline < Date.now();
  });
  // A ready_for_driver order can have more than one order_photos row
  // (multiple angles, a correction re-shoot) - the earliest one is the
  // moment it actually became ready, which is what the delay clock
  // should measure from.
  const breachedReadyForDriver = (readyForDriverRes.data ?? []).filter((o) => {
    const photos = (o.order_photos as { photographed_at: string }[]) ?? [];
    if (photos.length === 0) return false;
    const earliestPhotographedAt = Math.min(...photos.map((p) => new Date(p.photographed_at).getTime()));
    return earliestPhotographedAt + PREP_ALERT_THRESHOLD_MINUTES * 60_000 < Date.now();
  });
  const breached = [...breachedDispatched, ...breachedPreparing, ...breachedReadyForDriver];
  const checked = (dispatchedRes.data?.length ?? 0) + (preparingRes.data?.length ?? 0) + (readyForDriverRes.data?.length ?? 0);

  if (breached.length === 0) {
    return jsonResponse({ checked, flagged: 0 });
  }

  // Each group's UPDATE is re-scoped to the exact status it was selected
  // under (not just id) - the SELECT above is a snapshot, and time passes
  // between it and this UPDATE, so an order that was legitimately
  // cancelled/delivered/moved on by staff in that window must not get
  // silently overwritten back to 'delayed'. Every other order-mutating
  // function in this codebase (accept-order, dispatch-order, cancel-order,
  // confirm-delivery) follows this same "re-check status at write time"
  // rule for the same reason.
  const updates: Promise<{ data: { id: number }[] | null; error: { message: string } | null }>[] = [];
  if (breachedDispatched.length > 0) {
    updates.push(
      admin
        .from("orders")
        .update({ status: "delayed" })
        .in("id", breachedDispatched.map((o) => o.id))
        .eq("status", "out_for_delivery")
        .select("id"),
    );
  }
  if (breachedPreparing.length > 0) {
    updates.push(
      admin
        .from("orders")
        .update({ status: "delayed" })
        .in("id", breachedPreparing.map((o) => o.id))
        .eq("status", "preparing")
        .select("id"),
    );
  }
  if (breachedReadyForDriver.length > 0) {
    updates.push(
      admin
        .from("orders")
        .update({ status: "delayed" })
        .in("id", breachedReadyForDriver.map((o) => o.id))
        .eq("status", "ready_for_driver")
        .select("id"),
    );
  }
  const updateResults = await Promise.all(updates);
  const updateError = updateResults.find((r) => r.error)?.error;
  if (updateError) return dbErrorResponse("check-sla-breaches", updateError.message);

  // Only alert for orders actually flipped to 'delayed' just now - one of
  // them may have already moved on (cancelled/delivered/etc.) in the
  // window between the SELECT above and this UPDATE, and the per-group
  // .eq("status", ...) guard above correctly skipped writing to it, so it
  // must not get a "delayed" alert either.
  const actuallyDelayedIds = new Set(updateResults.flatMap((r) => (r.data ?? []).map((row) => row.id)));
  const actuallyDelayed = breached.filter((o) => actuallyDelayedIds.has(o.id));
  await Promise.all(actuallyDelayed.map((o) => alertManagersOrderDelayed(o.id, o.branch_id)));

  return jsonResponse({ checked, flagged: actuallyDelayed.length, at: nowIso });
});
