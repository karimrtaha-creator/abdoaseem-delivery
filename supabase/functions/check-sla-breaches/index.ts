// Section 4: "لو الطيار عدّى الـ SLA وهو لسه في الطريق... السيستم يبعت
// إشعار للمدير فورًا". Meant to run on a schedule (e.g. every 1-2 minutes
// via Supabase Cron / pg_cron+pg_net calling this function's URL) rather
// than being invoked by a client. Flips out_for_delivery orders that have
// blown their SLA to status='delayed' (closest existing enum value to a
// live "breached, still in transit" flag) and alerts managers once per
// breach - it will not re-alert an order already marked delayed.
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/auth.ts";
import { alertManagersOrderDelayed } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await admin
    .from("orders")
    .select("id, branch_id, dispatch_time, sla_minutes")
    .eq("status", "out_for_delivery")
    .not("dispatch_time", "is", null);
  if (error) return errorResponse(error.message, 500);

  const breached = (candidates ?? []).filter((o) => {
    const deadline = new Date(o.dispatch_time).getTime() + o.sla_minutes * 60_000;
    return deadline < Date.now();
  });

  if (breached.length === 0) {
    return jsonResponse({ checked: candidates?.length ?? 0, flagged: 0 });
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({ status: "delayed" })
    .in("id", breached.map((o) => o.id));
  if (updateError) return errorResponse(updateError.message, 500);

  await Promise.all(breached.map((o) => alertManagersOrderDelayed(o.id, o.branch_id)));

  return jsonResponse({ checked: candidates?.length ?? 0, flagged: breached.length, at: nowIso });
});
