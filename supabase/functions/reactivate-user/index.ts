// Counterpart to deactivate-user - general_manager only (branch_manager/
// regional_manager retired 2026-08-21, see roleScopes.ts), undoing both
// effects deactivate-user applied:
//   1. is_active = true on public.users, so RLS lets them read/write again.
//   2. Clear the auth ban (ban_duration: "none") so they can sign in again.
// Both are required for the same reason deactivate-user needs both: RLS
// alone would still let an old, not-yet-expired session read data even if
// re-login stayed blocked, and clearing only the ban without is_active
// would leave RLS still shutting them out.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "general_manager") {
    return errorResponse("only general_manager can reactivate users", 403);
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
  if (targetError) return dbErrorResponse("reactivate-user", targetError.message);
  if (!target) return errorResponse("user not found", 404);

  // No further scope check - caller is already confirmed general_manager
  // above, and any target is allowed.

  if (target.is_active) {
    return jsonResponse({ user_id: targetId, result: "already_active" });
  }

  const { error: updateError } = await admin
    .from("users")
    .update({ is_active: true })
    .eq("id", targetId);
  if (updateError) return dbErrorResponse("reactivate-user", updateError.message);

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
