// Finding #006 (security audit): a single append-only log() call wired
// into every function that changes a role/account or moves an order
// through its lifecycle. Never pass a password, JWT, or other secret in
// `metadata` - this table is readable (SELECT only) by general_manager
// and is meant for "who did what, when", not credential storage.
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CallerProfile } from "./auth.ts";

export async function logAudit(
  admin: SupabaseClient,
  actor: CallerProfile,
  action: string,
  entityType: string,
  entityId: string | number,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    actor_user_id: actor.id,
    actor_role: actor.role,
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    branch_id: actor.branch_id,
    metadata,
  });
  // Best-effort: a logging failure must never block the real action it's
  // describing (the account change / order transition already committed
  // by the time this runs) - same "fail open, just warn" posture as the
  // rate limiter's own RPC-error handling.
  if (error) {
    console.error(`logAudit: failed to write audit_log row (${action} ${entityType}/${entityId}):`, error.message);
  }
}
