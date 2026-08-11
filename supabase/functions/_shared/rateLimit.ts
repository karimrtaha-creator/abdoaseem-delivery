import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Finding #001 (security audit) - fixed-window limiter backed by
// public.check_rate_limit (migration 0032), which does the atomic
// increment-and-compare in one SQL statement so concurrent requests on
// the same key can't all slip through the limit at once.
//
// Keys are per-endpoint + per-authenticated-caller, never per-IP alone -
// every endpoint this is attached to already requires a real session
// (see getCaller() in each function), so the caller's own id is a much
// more meaningful signal than an IP address a NAT'd office would share
// across many legitimate staff.
export async function checkRateLimit(
  admin: SupabaseClient,
  endpoint: string,
  callerId: string,
  windowSeconds: number,
  maxRequests: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: `${endpoint}:${callerId}`,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  });
  if (error) {
    // Fail open, not closed - a rate-limiter outage must never be able to
    // take down order creation/dispatch/etc. itself. Logged so a real
    // outage is still visible.
    console.warn(`checkRateLimit(${endpoint}) errored, allowing request: ${error.message}`);
    return true;
  }
  return data as boolean;
}
