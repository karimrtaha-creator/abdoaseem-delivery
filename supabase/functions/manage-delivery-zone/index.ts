// Delivery zones are the real per-branch pricing model (Karim's explicit
// 2026-08-13 correction: branches.delivery_fee is only ever a fallback for
// addresses with no zone_id, delivery_zones is the source of truth). This
// is the one piece that didn't already exist: an authorized, audited way
// to add/edit/enable/disable/delete a zone from the Staff/Admin Portal.
// RLS on delivery_zones already restricts writes to general_manager/
// team_leader (delivery_zones_write_general_manager, unchanged here) -
// this function re-checks the same restriction independently and adds the
// audit trail, matching update-branch-delivery-fee's pattern.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";

type Action = "create" | "update" | "toggle_active" | "delete";

interface Body {
  action?: Action;
  zone_id?: number;
  branch_id?: number;
  zone_name?: string;
  delivery_fee?: number;
  is_active?: boolean;
}

const AUTHORIZED_ROLES = ["general_manager", "team_leader"];

// Security audit finding F-03: only a lower bound (>= 0) was ever
// checked - an absurd fee (e.g. 99999999999999) was accepted outright.
// This upper bound is a placeholder pending a real number from Karim;
// easy to change in one place. Mirrored in update-branch-delivery-fee
// for the same reason MAX_ATTEMPTS/OTP_VALIDITY_MINUTES are duplicated
// rather than shared elsewhere in this project - two call sites doesn't
// justify a new shared module.
const MAX_DELIVERY_FEE = 500;

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!AUTHORIZED_ROLES.includes(caller.role)) {
    return errorResponse("only general_manager/team_leader can manage delivery zones", 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }

  const admin = getAdminClient();

  if (body.action === "create") {
    const branchId = body.branch_id;
    const zoneName = body.zone_name?.trim();
    const fee = body.delivery_fee;
    if (!branchId) return errorResponse("branch_id is required");
    if (!zoneName) return errorResponse("zone_name is required");
    if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0 || fee > MAX_DELIVERY_FEE) {
      return errorResponse(`delivery_fee must be a number between 0 and ${MAX_DELIVERY_FEE}`);
    }

    const { data: branch } = await admin.from("branches").select("id, name").eq("id", branchId).maybeSingle();
    if (!branch) return errorResponse("branch not found", 404);

    const { data: zone, error: insertError } = await admin
      .from("delivery_zones")
      .insert({ branch_id: branchId, zone_name: zoneName, delivery_fee: fee })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        return errorResponse(`فيه منطقة اسمها "${zoneName}" في ${branch.name} خالص`, 409);
      }
      return dbErrorResponse("manage-delivery-zone", insertError.message);
    }

    await logAudit(admin, caller, "DELIVERY_ZONE_CREATED", "delivery_zone", zone.id, {
      branch_id: branchId,
      branch_name: branch.name,
      zone_name: zoneName,
      delivery_fee: fee,
    });
    return jsonResponse({ zone_id: zone.id });
  }

  if (body.action === "update") {
    const zoneId = body.zone_id;
    if (!zoneId) return errorResponse("zone_id is required");
    const { data: zone } = await admin
      .from("delivery_zones")
      .select("id, branch_id, zone_name, delivery_fee")
      .eq("id", zoneId)
      .maybeSingle();
    if (!zone) return errorResponse("zone not found", 404);

    const updates: { zone_name?: string; delivery_fee?: number } = {};
    if (body.zone_name != null) {
      const trimmed = body.zone_name.trim();
      if (!trimmed) return errorResponse("zone_name can't be empty");
      updates.zone_name = trimmed;
    }
    if (body.delivery_fee != null) {
      if (
        typeof body.delivery_fee !== "number" ||
        !Number.isFinite(body.delivery_fee) ||
        body.delivery_fee < 0 ||
        body.delivery_fee > MAX_DELIVERY_FEE
      ) {
        return errorResponse(`delivery_fee must be a number between 0 and ${MAX_DELIVERY_FEE}`);
      }
      updates.delivery_fee = body.delivery_fee;
    }
    if (Object.keys(updates).length === 0) return errorResponse("nothing to update");

    const { error: updateError } = await admin.from("delivery_zones").update(updates).eq("id", zoneId);
    if (updateError) {
      if (updateError.code === "23505") {
        return errorResponse(`فيه منطقة تانية بنفس الاسم في نفس الفرع`, 409);
      }
      return dbErrorResponse("manage-delivery-zone", updateError.message);
    }

    if (updates.delivery_fee != null && updates.delivery_fee !== Number(zone.delivery_fee)) {
      await logAudit(admin, caller, "DELIVERY_ZONE_FEE_CHANGED", "delivery_zone", zoneId, {
        branch_id: zone.branch_id,
        zone_name: updates.zone_name ?? zone.zone_name,
        old_value: Number(zone.delivery_fee),
        new_value: updates.delivery_fee,
      });
    }
    if (updates.zone_name != null && updates.zone_name !== zone.zone_name) {
      await logAudit(admin, caller, "DELIVERY_ZONE_RENAMED", "delivery_zone", zoneId, {
        branch_id: zone.branch_id,
        old_value: zone.zone_name,
        new_value: updates.zone_name,
      });
    }
    return jsonResponse({ zone_id: zoneId, changed: true });
  }

  if (body.action === "toggle_active") {
    const zoneId = body.zone_id;
    if (!zoneId) return errorResponse("zone_id is required");
    if (typeof body.is_active !== "boolean") return errorResponse("is_active must be a boolean");

    const { data: zone } = await admin
      .from("delivery_zones")
      .select("id, branch_id, zone_name")
      .eq("id", zoneId)
      .maybeSingle();
    if (!zone) return errorResponse("zone not found", 404);

    const { error: updateError } = await admin
      .from("delivery_zones")
      .update({ is_active: body.is_active })
      .eq("id", zoneId);
    if (updateError) return dbErrorResponse("manage-delivery-zone", updateError.message);

    await logAudit(admin, caller, body.is_active ? "DELIVERY_ZONE_ENABLED" : "DELIVERY_ZONE_DISABLED", "delivery_zone", zoneId, {
      branch_id: zone.branch_id,
      zone_name: zone.zone_name,
    });
    return jsonResponse({ zone_id: zoneId, is_active: body.is_active });
  }

  if (body.action === "delete") {
    const zoneId = body.zone_id;
    if (!zoneId) return errorResponse("zone_id is required");
    const { data: zone } = await admin
      .from("delivery_zones")
      .select("id, branch_id, zone_name")
      .eq("id", zoneId)
      .maybeSingle();
    if (!zone) return errorResponse("zone not found", 404);

    const { error: deleteError } = await admin.from("delivery_zones").delete().eq("id", zoneId);
    if (!deleteError) {
      await logAudit(admin, caller, "DELIVERY_ZONE_DELETED", "delivery_zone", zoneId, {
        branch_id: zone.branch_id,
        zone_name: zone.zone_name,
      });
      return jsonResponse({ zone_id: zoneId, deleted: true, soft_deleted: false });
    }

    // 23503 = real customer_addresses/order history still points at this
    // zone (ON DELETE NO ACTION, same "protect real history" pattern as
    // menu item deletion) - fall back to disabling it instead of failing
    // outright, same way MenuManagement.tsx handles an un-deletable item.
    if (deleteError.code === "23503") {
      const { error: disableError } = await admin.from("delivery_zones").update({ is_active: false }).eq("id", zoneId);
      if (disableError) return dbErrorResponse("manage-delivery-zone", disableError.message);
      await logAudit(admin, caller, "DELIVERY_ZONE_DISABLED", "delivery_zone", zoneId, {
        branch_id: zone.branch_id,
        zone_name: zone.zone_name,
        reason: "referenced by real address/order history - soft-deleted instead of hard-deleted",
      });
      return jsonResponse({ zone_id: zoneId, deleted: false, soft_deleted: true });
    }
    return dbErrorResponse("manage-delivery-zone", deleteError.message);
  }

  return errorResponse("action must be one of: create, update, toggle_active, delete");
});
