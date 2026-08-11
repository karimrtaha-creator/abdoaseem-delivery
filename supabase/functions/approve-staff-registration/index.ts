// Staff Registration feature (2026-08-11): approve or reject a pending
// request. Reuses create-user's exact authorization matrix (imported from
// _shared/roleScopes.ts, plus the same branch/region resolution logic
// duplicated deliberately below - not a shared function, so a future edit
// to one doesn't silently change the other's behavior without review) -
// a branch_manager can never approve a regional_manager/general_manager
// request, and a regional_manager can never approve a request for a
// branch outside their own region, exactly like they can never CREATE
// one directly either.
//
// Branch/region are re-validated fresh at approval time, not trusted from
// the stored request - if a branch/region was deleted or changed between
// submission and review, approval fails with a clear error instead of
// silently granting access to something that no longer exists.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors } from "../_shared/cors.ts";
import { getAdminClient, getCaller, AppRole } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

interface ApproveBody {
  request_id?: number;
  action?: "approve" | "reject";
  rejection_reason?: string;
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["general_manager", "regional_manager", "branch_manager"].includes(caller.role)) {
    return errorResponse("only general_manager/regional_manager/branch_manager can review requests", 403);
  }

  let body: ApproveBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const { request_id, action } = body;
  if (!request_id || !["approve", "reject"].includes(action ?? "")) {
    return errorResponse("request_id and action ('approve'|'reject') are required");
  }

  const admin = getAdminClient();

  const withinLimit = await checkRateLimit(admin, "approve-staff-registration", caller.id, 60, 20);
  if (!withinLimit) return errorResponse("too many requests - slow down", 429);

  const { data: reqRow, error: reqError } = await admin
    .from("staff_registration_requests")
    .select("id, user_id, requested_name, requested_role, requested_branch_id, requested_region_id, status")
    .eq("id", request_id)
    .single();
  if (reqError || !reqRow) return errorResponse("request not found", 404);
  if (reqRow.status !== "pending") {
    return errorResponse(`this request was already ${reqRow.status} - decisions are final`, 409);
  }

  if (action === "reject") {
    const { error: updateError } = await admin
      .from("staff_registration_requests")
      .update({
        status: "rejected",
        reviewed_by: caller.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: body.rejection_reason?.trim() || null,
      })
      .eq("id", request_id)
      .eq("status", "pending");
    if (updateError) return errorResponse(updateError.message, 500);
    await logAudit(admin, caller, "staff_registration_rejected", "staff_registration_request", request_id, {
      requested_name: reqRow.requested_name,
      requested_role: reqRow.requested_role,
      rejection_reason: body.rejection_reason ?? null,
    });
    return jsonResponse({ request_id, status: "rejected" });
  }

  // action === "approve" - same authorization matrix as create-user,
  // re-validated fresh against the stored request.
  const role = reqRow.requested_role as AppRole;
  let resolvedBranchId: number | null = null;
  let resolvedRegionId: number | null = null;

  if (caller.role === "general_manager") {
    if (["driver", "dispatcher", "branch_manager"].includes(role)) {
      if (!reqRow.requested_branch_id) return errorResponse("this request has no branch_id - cannot approve", 422);
      const { data: branch } = await admin.from("branches").select("id").eq("id", reqRow.requested_branch_id).maybeSingle();
      if (!branch) return errorResponse("the requested branch no longer exists - reject or ask for resubmission", 422);
      resolvedBranchId = reqRow.requested_branch_id;
    } else if (role === "regional_manager") {
      if (!reqRow.requested_region_id) return errorResponse("this request has no region_id - cannot approve", 422);
      const { data: region } = await admin.from("regions").select("id").eq("id", reqRow.requested_region_id).maybeSingle();
      if (!region) return errorResponse("the requested region no longer exists - reject or ask for resubmission", 422);
      resolvedRegionId = reqRow.requested_region_id;
    }
    // central roles (general_manager/team_leader/call_center): neither field applies.
  } else if (caller.role === "regional_manager") {
    if (!["branch_manager", "dispatcher", "driver"].includes(role)) {
      return errorResponse("regional_manager can only approve branch_manager, dispatcher, or driver requests", 403);
    }
    if (!reqRow.requested_branch_id) return errorResponse("this request has no branch_id - cannot approve", 422);
    const { data: branch } = await admin
      .from("branches")
      .select("id, region_id")
      .eq("id", reqRow.requested_branch_id)
      .maybeSingle();
    if (!branch) return errorResponse("the requested branch no longer exists - reject or ask for resubmission", 422);
    if (branch.region_id !== caller.region_id) {
      return errorResponse("that branch is not in your region", 403);
    }
    resolvedBranchId = reqRow.requested_branch_id;
  } else {
    // branch_manager
    if (!["dispatcher", "driver"].includes(role)) {
      return errorResponse("branch_manager can only approve dispatcher or driver requests", 403);
    }
    if (reqRow.requested_branch_id !== caller.branch_id) {
      return errorResponse("that request is not for your branch", 403);
    }
    // Forced to the caller's own branch regardless - same "never trust a
    // client-influenced branch_id for a role whose whole authority is 'my
    // branch only'" rule create-user itself follows.
    resolvedBranchId = caller.branch_id;
  }

  const profileFields = {
    name: reqRow.requested_name,
    role,
    branch_id: resolvedBranchId,
    region_id: resolvedRegionId,
    is_active: true,
  };
  const { error: userUpdateError } = await admin.from("users").update(profileFields).eq("id", reqRow.user_id);
  if (userUpdateError) return errorResponse(userUpdateError.message, 500);

  const { error: reqUpdateError } = await admin
    .from("staff_registration_requests")
    .update({ status: "approved", reviewed_by: caller.id, reviewed_at: new Date().toISOString() })
    .eq("id", request_id)
    .eq("status", "pending");
  if (reqUpdateError) return errorResponse(reqUpdateError.message, 500);

  await logAudit(admin, caller, "staff_registration_approved", "staff_registration_request", request_id, {
    user_id: reqRow.user_id,
    role,
    branch_id: resolvedBranchId,
    region_id: resolvedRegionId,
  });

  return jsonResponse({
    request_id,
    status: "approved",
    user_id: reqRow.user_id,
    role,
    branch_id: resolvedBranchId,
    region_id: resolvedRegionId,
  });
});
