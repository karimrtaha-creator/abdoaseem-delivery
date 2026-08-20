// Same safe delete pattern as delete-branch/manage-delivery-zone: attempt
// a real DELETE first, and if the region still has real history pointing
// at it (branches, staff, saved customer addresses, or staff-registration
// requests - all ON DELETE NO ACTION), fall back to marking it inactive
// instead of failing outright.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (caller.role !== "general_manager") return errorResponse("only general_manager can delete a region", 403);

  let body: { region_id?: number };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const regionId = body.region_id;
  if (!regionId) return errorResponse("region_id is required");

  const admin = getAdminClient();
  const { data: region } = await admin.from("regions").select("id, name").eq("id", regionId).maybeSingle();
  if (!region) return errorResponse("region not found", 404);

  const { error: deleteError } = await admin.from("regions").delete().eq("id", regionId);
  if (!deleteError) {
    await logAudit(admin, caller, "REGION_DELETED", "region", regionId, { region_name: region.name });
    return jsonResponse({ region_id: regionId, deleted: true, soft_deleted: false });
  }

  if (deleteError.code === "23503") {
    const { error: disableError } = await admin.from("regions").update({ is_active: false }).eq("id", regionId);
    if (disableError) return dbErrorResponse("delete-region", disableError.message);
    await logAudit(admin, caller, "REGION_DEACTIVATED", "region", regionId, {
      region_name: region.name,
      reason: "referenced by real branches/staff/addresses - soft-deleted instead of hard-deleted",
    });
    return jsonResponse({ region_id: regionId, deleted: false, soft_deleted: true });
  }
  return dbErrorResponse("delete-region", deleteError.message);
});
