// Same safe delete pattern manage-delivery-zone's "delete" action already
// uses: attempt a real DELETE first, and if the branch still has real
// history pointing at it (orders, staff, saved customer addresses,
// delivery zones, complaints, staff-registration requests, SLA tiers, or
// another branch's delivery_fallback_branch_id - all ON DELETE NO ACTION),
// fall back to marking it inactive instead of failing outright. A branch
// with genuinely zero history (created by mistake, never used) is removed
// for real.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "general_manager") return errorResponse("only general_manager can delete a branch", 403);

  let body: { branch_id?: number };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const branchId = body.branch_id;
  if (!branchId) return errorResponse("branch_id is required");

  const admin = getAdminClient();
  const { data: branch } = await admin.from("branches").select("id, name").eq("id", branchId).maybeSingle();
  if (!branch) return errorResponse("branch not found", 404);

  const { error: deleteError } = await admin.from("branches").delete().eq("id", branchId);
  if (!deleteError) {
    await logAudit(admin, caller, "BRANCH_DELETED", "branch", branchId, { branch_name: branch.name });
    return jsonResponse({ branch_id: branchId, deleted: true, soft_deleted: false });
  }

  if (deleteError.code === "23503") {
    const { error: disableError } = await admin.from("branches").update({ is_active: false }).eq("id", branchId);
    if (disableError) return dbErrorResponse("delete-branch", disableError.message);
    await logAudit(admin, caller, "BRANCH_DEACTIVATED", "branch", branchId, {
      branch_name: branch.name,
      reason: "referenced by real orders/staff/addresses/zones - soft-deleted instead of hard-deleted",
    });
    return jsonResponse({ branch_id: branchId, deleted: false, soft_deleted: true });
  }
  return dbErrorResponse("delete-branch", deleteError.message);
});
