// Manager-triggered password reset for a staff account - same
// authorization matrix as deactivate-user/create-user. Unlike deactivate/
// delete, this applies regardless of the target's is_active state (a
// suspended employee's password still needs resetting before they're
// reactivated, and an active one may have simply forgotten theirs).
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

const REGIONAL_MANAGER_TARGETS = ["branch_manager", "dispatcher", "driver"];
const BRANCH_MANAGER_TARGETS = ["dispatcher", "driver"];

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["general_manager", "regional_manager", "branch_manager"].includes(caller.role)) {
    return errorResponse("only general_manager/regional_manager/branch_manager can reset passwords", 403);
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
    .select("id, role, branch_id, region_id, phone")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) return dbErrorResponse("reset-user-password", targetError.message);
  if (!target) return errorResponse("user not found", 404);

  if (caller.role === "regional_manager") {
    if (!REGIONAL_MANAGER_TARGETS.includes(target.role)) {
      return errorResponse("regional_manager can only reset passwords for branch_manager, dispatcher, or driver accounts", 403);
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
      return errorResponse("branch_manager can only reset passwords for dispatcher or driver accounts", 403);
    }
    if (target.branch_id !== caller.branch_id) {
      return errorResponse("that user is not in your branch", 403);
    }
  }
  // general_manager: no further scope check.

  const newPassword = generatePassword();
  const { error: updateError } = await admin.auth.admin.updateUserById(targetId, { password: newPassword });
  if (updateError) return dbErrorResponse("reset-user-password", updateError.message);

  // The password itself never goes in metadata - only that a reset happened.
  await logAudit(admin, caller, "password_reset", "user", targetId, {
    target_phone: target.phone,
  });

  return jsonResponse({
    user_id: targetId,
    phone: target.phone,
    // Shown exactly once - not stored anywhere, not retrievable again.
    new_password: newPassword,
  });
});
