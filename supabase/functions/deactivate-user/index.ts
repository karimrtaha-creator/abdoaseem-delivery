// Counterpart to create-user - same authorization matrix, mirrored:
//   general_manager  -> can deactivate anyone (except themselves)
//   regional_manager -> branch_manager / dispatcher / driver, only within
//                        their own region
//   branch_manager   -> dispatcher / driver, only within their own branch
//
// Two effects, deliberately both:
//   1. is_active = false on public.users - closes the RLS gap fixed in
//      0006_deactivation_and_scoped_creation.sql, so an already-open
//      session (e.g. a fired driver's app still on the orders list
//      screen) is cut off on its very next query, immediately, without
//      waiting for anything to expire.
//   2. Ban the matching auth.users account (ban_duration, effectively
//      permanent) - stops them from signing in again or refreshing an
//      existing session's token. Without this, RLS alone still protects
//      the data, but they could keep re-authenticating indefinitely.
// Neither one alone is enough: RLS-only leaves them able to keep logging
// back in; ban-only leaves an already-cached, not-yet-expired access
// token free to keep reading data until it naturally expires.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

const REGIONAL_MANAGER_TARGETS = ["branch_manager", "dispatcher", "driver"];
const BRANCH_MANAGER_TARGETS = ["dispatcher", "driver"];

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["general_manager", "regional_manager", "branch_manager"].includes(caller.role)) {
    return errorResponse("only general_manager/regional_manager/branch_manager can deactivate users", 403);
  }

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const targetId = body.user_id;
  if (!targetId) return errorResponse("user_id is required");

  if (targetId === caller.id) {
    return errorResponse("you cannot deactivate your own account", 403);
  }

  const admin = getAdminClient();
  const { data: target, error: targetError } = await admin
    .from("users")
    .select("id, role, branch_id, region_id, is_active, name")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) return errorResponse(targetError.message, 500);
  if (!target) return errorResponse("user not found", 404);

  if (caller.role === "regional_manager") {
    if (!REGIONAL_MANAGER_TARGETS.includes(target.role)) {
      return errorResponse("regional_manager can only deactivate branch_manager, dispatcher, or driver accounts", 403);
    }
    const { data: branch } = await admin
      .from("branches")
      .select("id, region_id")
      .eq("id", target.branch_id)
      .maybeSingle();
    if (!branch || branch.region_id !== caller.region_id) {
      return errorResponse("that user is not in your region", 403);
    }
  } else if (caller.role === "branch_manager") {
    if (!BRANCH_MANAGER_TARGETS.includes(target.role)) {
      return errorResponse("branch_manager can only deactivate dispatcher or driver accounts", 403);
    }
    if (target.branch_id !== caller.branch_id) {
      return errorResponse("that user is not in your branch", 403);
    }
  }
  // general_manager: no further scope check - any target except self
  // (already rejected above) is allowed.

  if (!target.is_active) {
    return jsonResponse({ user_id: targetId, result: "already_inactive" });
  }

  const { error: updateError } = await admin
    .from("users")
    .update({ is_active: false })
    .eq("id", targetId);
  if (updateError) return errorResponse(updateError.message, 500);

  const { error: banError } = await admin.auth.admin.updateUserById(targetId, {
    ban_duration: "876000h", // ~100 years - Supabase has no literal "forever", this is the accepted convention
  });
  if (banError) {
    // The row is already deactivated and RLS already blocks them (0006) -
    // this is a real partial failure worth surfacing, but not one that
    // should be silently invisible like the complaints-table issue earlier.
    console.error(`deactivate-user: is_active=false succeeded but auth ban failed for ${targetId}:`, banError.message);
    return errorResponse(
      `account deactivated (blocked at the database level) but the auth session ban failed - they cannot read data anymore, but may still be able to sign in until this is retried: ${banError.message}`,
      500,
    );
  }

  await logAudit(admin, caller, "user_deactivated", "user", targetId, {
    target_name: target.name,
    target_role: target.role,
  });

  return jsonResponse({ user_id: targetId, result: "deactivated" });
});
