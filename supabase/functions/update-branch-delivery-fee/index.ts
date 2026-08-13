// Branch delivery fee is a business-critical, money-affecting setting
// (spec item "Fixed Delivery Fee Per Branch") - changing it used to be a
// bare client-side `supabase.from("branches").update(...)` call, relying
// entirely on RLS (branches_write_general_manager) for authorization.
// RLS still enforces the same restriction here as defense in depth, but
// the change now also needs an audit trail, and audit_log has no
// client-reachable INSERT at all (service_role only) - so this needs an
// edge function, same as every other audited mutation in this project.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

interface UpdateFeeBody {
  branch_id?: number;
  delivery_fee?: number;
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "general_manager") {
    return errorResponse("only general_manager can change branch delivery fees", 403);
  }

  let body: UpdateFeeBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }

  const { branch_id: branchId, delivery_fee: newFee } = body;
  if (!branchId) return errorResponse("branch_id is required");
  if (typeof newFee !== "number" || !Number.isFinite(newFee) || newFee < 0) {
    return errorResponse("delivery_fee must be a number >= 0");
  }

  const admin = getAdminClient();

  const { data: branch, error: branchError } = await admin
    .from("branches")
    .select("id, name, delivery_fee")
    .eq("id", branchId)
    .maybeSingle();
  if (branchError) return errorResponse(branchError.message, 500);
  if (!branch) return errorResponse("branch not found", 404);

  const oldFee = Number(branch.delivery_fee);
  if (oldFee === newFee) {
    return jsonResponse({ branch_id: branchId, delivery_fee: newFee, changed: false });
  }

  const { error: updateError } = await admin.from("branches").update({ delivery_fee: newFee }).eq("id", branchId);
  if (updateError) return errorResponse(updateError.message, 500);

  await logAudit(admin, caller, "BRANCH_DELIVERY_FEE_CHANGED", "branch", branchId, {
    branch_name: branch.name,
    old_value: oldFee,
    new_value: newFee,
  });

  return jsonResponse({ branch_id: branchId, delivery_fee: newFee, changed: true });
});
