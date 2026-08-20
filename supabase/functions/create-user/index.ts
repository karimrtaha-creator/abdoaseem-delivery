// Staff account provisioning (spec section 6, "شاشة إدارة المستخدمين").
// Deliberately does NOT rely on the auth.users -> public.users trigger to
// populate the row, even though it was confirmed to correctly read
// user_metadata: the trigger has zero awareness of who is creating this
// account or the authorization matrix below, so it can never be the
// source of truth for a security-relevant field like role/branch_id. This
// function explicitly UPDATEs (INSERT fallback) the row itself after
// creating the auth account - the same pattern already proven in
// create-order for guest customers.
//
// Authorization matrix (enforced here, not just in RLS - hiding a role
// option from a screen is not a security control):
//   general_manager  -> any role, any branch/region
//   regional_manager -> branch_manager / dispatcher / driver, only within
//                        their own region
//   branch_manager   -> dispatcher / driver, only within their own branch
//
// call_center and team_leader are deliberately reachable by
// general_manager ONLY - they're central roles not tied to a branch or
// region, so neither regional_manager nor branch_manager (whose whole
// authority is branch/region-scoped) can ever create one. This is not an
// oversight; it's the intended design.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller, AppRole } from "../_shared/auth.ts";
import { logAudit } from "../_shared/audit.ts";
import { BRANCH_SCOPED_ROLES, REGION_SCOPED_ROLES, ALL_STAFF_ROLES } from "../_shared/roleScopes.ts";

const STAFF_EMAIL_DOMAIN = "abdoaseem.internal"; // same convention as apps/dispatcher-web + driver_app logins

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

interface CreateUserBody {
  name?: string;
  phone?: string;
  role?: string;
  branch_id?: number;
  region_id?: number;
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["general_manager", "regional_manager", "branch_manager"].includes(caller.role)) {
    return errorResponse("only general_manager/regional_manager/branch_manager can create users", 403);
  }

  let body: CreateUserBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }

  const name = body.name?.trim();
  const phone = body.phone?.replace(/\D/g, "");
  const role = body.role as AppRole | undefined;

  if (!name) return errorResponse("name is required");
  if (!phone || phone.length < 8) return errorResponse("a valid phone is required");
  if (!role || !ALL_STAFF_ROLES.includes(role)) {
    return errorResponse(`role must be one of: ${ALL_STAFF_ROLES.join(", ")}`);
  }

  const admin = getAdminClient();

  let resolvedBranchId: number | null = null;
  let resolvedRegionId: number | null = null;

  if (caller.role === "general_manager") {
    if (BRANCH_SCOPED_ROLES.includes(role)) {
      if (!body.branch_id) return errorResponse("branch_id is required for this role");
      const { data: branch } = await admin.from("branches").select("id").eq("id", body.branch_id).maybeSingle();
      if (!branch) return errorResponse("branch not found", 404);
      resolvedBranchId = body.branch_id;
    } else if (REGION_SCOPED_ROLES.includes(role)) {
      if (!body.region_id) return errorResponse("region_id is required for this role");
      const { data: region } = await admin.from("regions").select("id").eq("id", body.region_id).maybeSingle();
      if (!region) return errorResponse("region not found", 404);
      resolvedRegionId = body.region_id;
    }
    // CENTRAL_ROLES: resolvedBranchId/resolvedRegionId stay null regardless
    // of anything passed in the body - general_manager/team_leader/
    // call_center are never branch- or region-tied.
  } else if (caller.role === "regional_manager") {
    if (!["branch_manager", "dispatcher", "driver"].includes(role)) {
      return errorResponse(
        "regional_manager can only create branch_manager, dispatcher, or driver accounts",
        403,
      );
    }
    if (!body.branch_id) return errorResponse("branch_id is required");
    const { data: branch } = await admin
      .from("branches")
      .select("id, region_id")
      .eq("id", body.branch_id)
      .maybeSingle();
    if (!branch) return errorResponse("branch not found", 404);
    if (branch.region_id !== caller.region_id) {
      return errorResponse("that branch is not in your region", 403);
    }
    resolvedBranchId = body.branch_id;
  } else {
    // branch_manager
    if (!["dispatcher", "driver"].includes(role)) {
      return errorResponse("branch_manager can only create dispatcher or driver accounts", 403);
    }
    // A branch_manager displaced by assign-manager keeps their role and
    // stays active, but branch_id is nulled out (see assign-manager) - such
    // an account has no "my branch only" left to scope this to, so it must
    // be rejected rather than silently creating an unscoped staff account.
    if (!caller.branch_id) return errorResponse("your account has no branch assigned - contact a general manager", 403);
    // Forced to the caller's own branch - never trust a client-supplied
    // branch_id for a role whose whole authority is "my branch only".
    resolvedBranchId = caller.branch_id;
  }

  const email = `${phone}@${STAFF_EMAIL_DOMAIN}`;
  const password = generatePassword();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone, role, branch_id: resolvedBranchId, region_id: resolvedRegionId },
  });
  if (authError || !authUser?.user) {
    const msg = authError?.message ?? "unknown error";
    // Live-confirmed 2026-08-20: for this project's Supabase Auth config,
    // a duplicate email/phone doesn't always come back as "already
    // registered"/"already exists" - it can surface as the generic
    // "Database error creating new user" (the underlying unique-constraint
    // violation on auth.users, wrapped by GoTrue into a message with no
    // specific reason in it). Since createUser() is only ever called here
    // with a phone-derived synthetic email, and phone is the only unique
    // field being inserted, a duplicate is overwhelmingly the real cause
    // any time creation fails at all - checked first as the friendlier,
    // actionable message before falling back to the raw error.
    if (
      msg.toLowerCase().includes("already been registered") ||
      msg.toLowerCase().includes("already exists") ||
      msg.toLowerCase().includes("database error")
    ) {
      return errorResponse("this phone number is already registered to an account", 409);
    }
    return errorResponse(`failed to create account: ${msg}`, 500);
  }
  const newUserId = authUser.user.id;

  const profileFields = {
    name,
    phone,
    role,
    branch_id: resolvedBranchId,
    region_id: resolvedRegionId,
    is_active: true,
  };
  const { data: updatedRows, error: updateError } = await admin
    .from("users")
    .update(profileFields)
    .eq("id", newUserId)
    .select("id");
  if (updateError) return dbErrorResponse("create-user", updateError.message);
  if (!updatedRows || updatedRows.length === 0) {
    const { error: insertError } = await admin.from("users").insert({ id: newUserId, ...profileFields });
    if (insertError) return dbErrorResponse("create-user", insertError.message);
  }

  // Finding #006: never log the password - initial_password is the one
  // field this metadata blob must never carry.
  await logAudit(admin, caller, "user_created", "user", newUserId, {
    name,
    phone,
    role,
    branch_id: resolvedBranchId,
    region_id: resolvedRegionId,
  });

  return jsonResponse({
    user_id: newUserId,
    name,
    phone,
    role,
    branch_id: resolvedBranchId,
    region_id: resolvedRegionId,
    // Shown exactly once - not stored anywhere, not retrievable again.
    // The creating manager must relay it to the new employee now.
    initial_password: password,
  });
});
