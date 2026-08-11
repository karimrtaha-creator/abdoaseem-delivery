// Counterpart to deactivate-user - same authorization matrix, mirrored, but
// undoing both effects deactivate-user applied:
//   1. is_active = true on public.users, so RLS lets them read/write again.
//   2. Clear the auth ban (ban_duration: "none") so they can sign in again.
// Both are required for the same reason deactivate-user needs both: RLS
// alone would still let an old, not-yet-expired session read data even if
// re-login stayed blocked, and clearing only the ban without is_active
// would leave RLS still shutting them out.
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
    return errorResponse("only general_manager/regional_manager/branch_manager can reactivate users", 403);
  }

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const targetId = body.user_id;
  if (!targetId) return errorResponse("user_id is required");

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
      return errorResponse("regional_manager can only reactivate branch_manager, dispatcher, or driver accounts", 403);
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
      return errorResponse("branch_manager can only reactivate dispatcher or driver accounts", 403);
    }
    if (target.branch_id !== caller.branch_id) {
      return errorResponse("that user is not in your branch", 403);
    }
  }
  // general_manager: no further scope check - any target is allowed.

  if (target.is_active) {
    return jsonResponse({ user_id: targetId, result: "already_active" });
  }

  const { error: updateError } = await admin
    .from("users")
    .update({ is_active: true })
    .eq("id", targetId);
  if (updateError) return errorResponse(updateError.message, 500);

  const { error: unbanError } = await admin.auth.admin.updateUserById(targetId, {
    ban_duration: "none",
  });
  if (unbanError) {
    console.error(`reactivate-user: is_active=true succeeded but auth unban failed for ${targetId}:`, unbanError.message);
    return errorResponse(
      `account reactivated at the database level but clearing the auth ban failed - they may still be unable to sign in: ${unbanError.message}`,
      500,
    );
  }

  await logAudit(admin, caller, "user_reactivated", "user", targetId, {
    target_name: target.name,
    target_role: target.role,
  });

  return jsonResponse({ user_id: targetId, result: "reactivated" });
});
