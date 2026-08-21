// Staff Registration feature (2026-08-11), review authority rewritten
// 2026-08-21 per Karim's request: branch_manager/regional_manager are
// retired (roleScopes.ts), and general_manager is no longer the only
// approver - dispatcher can approve driver requests for their own branch,
// team_leader can approve call_center (Agent) requests, general_manager
// can approve anything. Nobody else (driver, call_center themselves) can
// review a request at all.
//
// Branch is re-validated fresh at approval time, not trusted from the
// stored request - if it was deleted/closed between submission and
// review, approval fails with a clear error instead of silently granting
// access to something that no longer exists.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller, AppRole, CallerProfile } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

interface ApproveBody {
  request_id?: number;
  action?: "approve" | "reject";
  rejection_reason?: string;
}

// Same check governs both approve and reject - a dispatcher who can't
// approve a team_leader request shouldn't be able to reject one either
// (that's still a review decision on a request outside their authority).
function canReview(caller: CallerProfile, requestedRole: AppRole, requestedBranchId: number | null): boolean {
  if (caller.role === "general_manager") return true;
  if (caller.role === "dispatcher") return requestedRole === "driver" && requestedBranchId === caller.branch_id;
  if (caller.role === "team_leader") return requestedRole === "call_center";
  return false;
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["general_manager", "dispatcher", "team_leader"].includes(caller.role)) {
    return errorResponse("only general_manager, dispatcher, or team_leader can review requests", 403);
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
    .select("id, user_id, requested_name, requested_role, requested_branch_id, status")
    .eq("id", request_id)
    .single();
  if (reqError || !reqRow) return errorResponse("request not found", 404);
  if (reqRow.status !== "pending") {
    return errorResponse(`this request was already ${reqRow.status} - decisions are final`, 409);
  }

  const requestedRole = reqRow.requested_role as AppRole;
  if (!canReview(caller, requestedRole, reqRow.requested_branch_id)) {
    return errorResponse("you are not authorized to review this request", 403);
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
    if (updateError) return dbErrorResponse("approve-staff-registration", updateError.message);
    await logAudit(admin, caller, "staff_registration_rejected", "staff_registration_request", request_id, {
      requested_name: reqRow.requested_name,
      requested_role: reqRow.requested_role,
      rejection_reason: body.rejection_reason ?? null,
    });
    return jsonResponse({ request_id, status: "rejected" });
  }

  // action === "approve"
  let resolvedBranchId: number | null = null;
  if (["driver", "dispatcher"].includes(requestedRole)) {
    if (!reqRow.requested_branch_id) return errorResponse("this request has no branch_id - cannot approve", 422);
    const { data: branch } = await admin.from("branches").select("id").eq("id", reqRow.requested_branch_id).maybeSingle();
    if (!branch) return errorResponse("the requested branch no longer exists - reject or ask for resubmission", 422);
    resolvedBranchId = reqRow.requested_branch_id;
  }
  // central roles (general_manager/team_leader/call_center): branch_id stays null.

  const profileFields = {
    name: reqRow.requested_name,
    role: requestedRole,
    branch_id: resolvedBranchId,
    region_id: null,
    is_active: true,
  };
  const { error: userUpdateError } = await admin.from("users").update(profileFields).eq("id", reqRow.user_id);
  if (userUpdateError) return dbErrorResponse("approve-staff-registration", userUpdateError.message);

  const { error: reqUpdateError } = await admin
    .from("staff_registration_requests")
    .update({ status: "approved", reviewed_by: caller.id, reviewed_at: new Date().toISOString() })
    .eq("id", request_id)
    .eq("status", "pending");
  if (reqUpdateError) return dbErrorResponse("approve-staff-registration", reqUpdateError.message);

  await logAudit(admin, caller, "staff_registration_approved", "staff_registration_request", request_id, {
    user_id: reqRow.user_id,
    role: requestedRole,
    branch_id: resolvedBranchId,
  });

  return jsonResponse({
    request_id,
    status: "approved",
    user_id: reqRow.user_id,
    role: requestedRole,
    branch_id: resolvedBranchId,
  });
});
