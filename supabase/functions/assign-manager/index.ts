// Spec section 6, "شاشة إدارة الفروع والمناطق" - general_manager only.
// Assigns an existing user as branch_manager of a branch, or
// regional_manager of a region, promoting/moving them regardless of
// their previous role.
//
// Confirmed behavior for "يحل محل أي مدير سابق لنفس الفرع تلقائيًا"
// (replaces any previous manager for that branch automatically): the
// displaced manager is NOT deactivated - they stay active, keep their
// role, and simply lose the branch/region tie (branch_id/region_id set
// to null) until the general_manager manually reassigns or deactivates
// them separately. Deactivation is deliberately a distinct, explicit
// action (deactivate-user), never an automatic side effect of this one.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";

interface AssignBody {
  user_id?: string;
  target_type?: "branch" | "region";
  target_id?: number;
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "general_manager") {
    return errorResponse("only general_manager can assign branch/region managers", 403);
  }

  let body: AssignBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const { user_id: targetUserId, target_type: targetType, target_id: targetId } = body;
  if (!targetUserId || !targetType || !targetId) {
    return errorResponse("user_id, target_type ('branch'|'region'), and target_id are required");
  }
  if (!["branch", "region"].includes(targetType)) {
    return errorResponse("target_type must be 'branch' or 'region'");
  }

  const admin = getAdminClient();

  const { data: targetUser, error: targetUserError } = await admin
    .from("users")
    .select("id, name")
    .eq("id", targetUserId)
    .maybeSingle();
  if (targetUserError) return dbErrorResponse("assign-manager", targetUserError.message);
  if (!targetUser) return errorResponse("user not found", 404);

  if (targetType === "branch") {
    const { data: branch } = await admin.from("branches").select("id").eq("id", targetId).maybeSingle();
    if (!branch) return errorResponse("branch not found", 404);

    const { data: displaced } = await admin
      .from("users")
      .select("id, name")
      .eq("role", "branch_manager")
      .eq("branch_id", targetId)
      .neq("id", targetUserId)
      .maybeSingle();

    if (displaced) {
      const { error: displaceError } = await admin.from("users").update({ branch_id: null }).eq("id", displaced.id);
      if (displaceError) return dbErrorResponse("assign-manager", displaceError.message);
    }

    const { error: assignError } = await admin
      .from("users")
      .update({ role: "branch_manager", branch_id: targetId, region_id: null })
      .eq("id", targetUserId);
    if (assignError) return dbErrorResponse("assign-manager", assignError.message);

    return jsonResponse({
      user_id: targetUserId,
      assigned: "branch_manager",
      branch_id: targetId,
      displaced_user: displaced ? { id: displaced.id, name: displaced.name } : null,
    });
  }

  // target_type === "region"
  const { data: region } = await admin.from("regions").select("id").eq("id", targetId).maybeSingle();
  if (!region) return errorResponse("region not found", 404);

  const { data: displaced } = await admin
    .from("users")
    .select("id, name")
    .eq("role", "regional_manager")
    .eq("region_id", targetId)
    .neq("id", targetUserId)
    .maybeSingle();

  if (displaced) {
    const { error: displaceError } = await admin.from("users").update({ region_id: null }).eq("id", displaced.id);
    if (displaceError) return dbErrorResponse("assign-manager", displaceError.message);
  }

  const { error: assignError } = await admin
    .from("users")
    .update({ role: "regional_manager", region_id: targetId, branch_id: null })
    .eq("id", targetUserId);
  if (assignError) return dbErrorResponse("assign-manager", assignError.message);

  return jsonResponse({
    user_id: targetUserId,
    assigned: "regional_manager",
    region_id: targetId,
    displaced_user: displaced ? { id: displaced.id, name: displaced.name } : null,
  });
});
