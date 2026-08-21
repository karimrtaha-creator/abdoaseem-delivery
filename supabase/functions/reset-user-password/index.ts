// Manager-triggered password reset for a staff account - general_manager
// only (branch_manager/regional_manager retired 2026-08-21, see
// roleScopes.ts). Unlike deactivate/delete, this applies regardless of
// the target's is_active state (a suspended employee's password still
// needs resetting before they're reactivated, and an active one may have
// simply forgotten theirs).
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

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
  if (caller.role !== "general_manager") {
    return errorResponse("only general_manager can reset passwords", 403);
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

  // No further scope check - caller is already confirmed general_manager above.

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
