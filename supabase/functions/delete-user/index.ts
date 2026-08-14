// Permanent removal of a staff account - same authorization matrix as
// deactivate-user, but deliberately narrower in two ways:
//   1. Only operates on an already-deactivated target. Deleting an active
//      account skips the "cut off access immediately" ban-and-block step
//      deactivate-user performs, so this forces deactivate-first.
//   2. Refuses to delete a target with any order/complaint/rating history
//      (driver_id/dispatcher_id/accepted_by/cancelled_by on orders,
//      complaints.driver_id, order_ratings.customer_id,
//      menu_item_branch_closures.closed_by all reference public.users
//      with ON DELETE NO ACTION) - those rows are real business records
//      (who delivered/accepted/cancelled an order, who filed a closure)
//      and silently losing that attribution is worse than leaving the
//      account deactivated forever. Deactivation already fully and
//      permanently blocks their access; delete is only for accounts that
//      never did any real work (e.g. created by mistake).
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

const REGIONAL_MANAGER_TARGETS = ["branch_manager", "dispatcher", "driver"];
const BRANCH_MANAGER_TARGETS = ["dispatcher", "driver"];

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["general_manager", "regional_manager", "branch_manager"].includes(caller.role)) {
    return errorResponse("only general_manager/regional_manager/branch_manager can delete users", 403);
  }

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const targetId = body.user_id;
  if (!targetId) return errorResponse("user_id is required");

  if (targetId === caller.id) {
    return errorResponse("you cannot delete your own account", 403);
  }

  const admin = getAdminClient();
  const { data: target, error: targetError } = await admin
    .from("users")
    .select("id, role, branch_id, region_id, is_active, name")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) return dbErrorResponse("delete-user", targetError.message);
  if (!target) return errorResponse("user not found", 404);

  if (caller.role === "regional_manager") {
    if (!REGIONAL_MANAGER_TARGETS.includes(target.role)) {
      return errorResponse("regional_manager can only delete branch_manager, dispatcher, or driver accounts", 403);
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
      return errorResponse("branch_manager can only delete dispatcher or driver accounts", 403);
    }
    if (target.branch_id !== caller.branch_id) {
      return errorResponse("that user is not in your branch", 403);
    }
  }
  // general_manager: no further scope check.

  if (target.is_active) {
    return errorResponse("deactivate this account first, then delete it", 409);
  }

  const [orderRefs, complaintRefs, ratingRefs, closureRefs] = await Promise.all([
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .or(`driver_id.eq.${targetId},dispatcher_id.eq.${targetId},accepted_by.eq.${targetId},cancelled_by.eq.${targetId}`),
    admin.from("complaints").select("id", { count: "exact", head: true }).eq("driver_id", targetId),
    admin.from("order_ratings").select("id", { count: "exact", head: true }).eq("customer_id", targetId),
    admin.from("menu_item_branch_closures").select("menu_item_id", { count: "exact", head: true }).eq("closed_by", targetId),
  ]);
  const historyCount =
    (orderRefs.count ?? 0) + (complaintRefs.count ?? 0) + (ratingRefs.count ?? 0) + (closureRefs.count ?? 0);
  if (historyCount > 0) {
    return errorResponse(
      "this account has order/complaint history and can't be permanently deleted - it stays deactivated (blocked for good) instead",
      409,
    );
  }

  // Deletes the auth.users row, which cascades to the matching public.users
  // row via the existing id -> auth.users foreign key (ON DELETE CASCADE).
  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) return dbErrorResponse("delete-user", deleteError.message);

  // Logged after the fact with a name/role snapshot in metadata - the
  // public.users row is already gone by this point (cascade delete), so
  // entity_id alone wouldn't be enough to identify who this was later.
  await logAudit(admin, caller, "user_deleted", "user", targetId, {
    target_name: target.name,
    target_role: target.role,
  });

  return jsonResponse({ user_id: targetId, result: "deleted" });
});
