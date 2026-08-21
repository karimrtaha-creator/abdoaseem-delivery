// Staff Registration feature (2026-08-11): a Google-OAuth-authenticated
// applicant (role='customer' - see the hardened handle_new_user(), which
// never grants anything else at signup) requests a real staff role here.
// Requesting a role never grants it - only approve-staff-registration can
// do that, and only within the caller's own authority. Any authenticated
// user may call this; the whole point is anyone can ASK.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller, AppRole } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { BRANCH_SCOPED_ROLES, ALL_STAFF_ROLES } from "../_shared/roleScopes.ts";

interface SubmitBody {
  name?: string;
  role?: string;
  branch_id?: number;
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }

  const name = body.name?.trim();
  const role = body.role as AppRole | undefined;
  if (!name) return errorResponse("name is required");
  if (!role || !ALL_STAFF_ROLES.includes(role)) {
    return errorResponse(`role must be one of: ${ALL_STAFF_ROLES.join(", ")}`);
  }

  const admin = getAdminClient();

  const withinLimit = await checkRateLimit(admin, "submit-staff-registration", caller.id, 3600, 5);
  if (!withinLimit) return errorResponse("too many requests - slow down", 429);

  let requestedBranchId: number | null = null;

  if (BRANCH_SCOPED_ROLES.includes(role)) {
    if (!body.branch_id) return errorResponse("branch_id is required for this role");
    const { data: branch } = await admin.from("branches").select("id").eq("id", body.branch_id).maybeSingle();
    if (!branch) return errorResponse("branch not found", 404);
    requestedBranchId = body.branch_id;
  }
  // CENTRAL_ROLES (general_manager/team_leader/call_center): branch_id
  // stays null regardless of what was sent.

  // Friendly check before hitting the exclude constraint - same info
  // either way, this just gives a clear message instead of a raw
  // constraint-violation error.
  const { data: existingPending } = await admin
    .from("staff_registration_requests")
    .select("id")
    .eq("user_id", caller.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existingPending) {
    return errorResponse("you already have a pending registration request - wait for it to be reviewed", 409);
  }

  const { data: newRequest, error: insertError } = await admin
    .from("staff_registration_requests")
    .insert({
      user_id: caller.id,
      requested_name: name,
      requested_role: role,
      requested_branch_id: requestedBranchId,
      requested_region_id: null,
    })
    .select("id, requested_at")
    .single();
  if (insertError) {
    if (insertError.code === "23P01") {
      // The exclude constraint's own race-condition backstop - the
      // friendly check above already covers the common case.
      return errorResponse("you already have a pending registration request - wait for it to be reviewed", 409);
    }
    return dbErrorResponse("submit-staff-registration", insertError.message);
  }

  await logAudit(admin, caller, "staff_registration_submitted", "staff_registration_request", newRequest.id, {
    requested_name: name,
    requested_role: role,
    requested_branch_id: requestedBranchId,
  });

  return jsonResponse({
    request_id: newRequest.id,
    status: "pending",
    requested_at: newRequest.requested_at,
  });
});
