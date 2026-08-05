import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type AppRole =
  | "driver"
  | "customer"
  | "branch_manager"
  | "regional_manager"
  | "general_manager"
  | "team_leader"
  | "call_center"
  | "dispatcher";

export interface CallerProfile {
  id: string;
  role: AppRole;
  branch_id: number | null;
  region_id: number | null;
  is_active: boolean;
  name: string;
  phone: string;
}

// Admin client - bypasses RLS. Every mutation in these functions is only
// ever performed after the caller's role has been independently verified
// against public.users below, so bypassing RLS here is intentional and safe.
export function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Resolves the caller from the incoming request's Authorization header and
// loads their profile row (role/branch/region/active) via the admin client.
// Returns null if the request has no valid session or the profile is missing.
export async function getCaller(req: Request): Promise<CallerProfile | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    if (userError) console.error("getCaller: auth.getUser() failed:", userError.message);
    return null;
  }

  const admin = getAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id, role, branch_id, region_id, is_active, name, phone")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    // Logged distinctly from "no session" above: a valid, authenticated
    // caller with no matching profile row is usually either a missing
    // service_role grant (see 0004_service_role_grants.sql) or a real
    // orphaned auth user with no public.users row - both look identical
    // to the client (401 "unauthorized"), so the function logs are the
    // only place this distinction is visible.
    if (profileError) {
      console.error(
        `getCaller: profile lookup failed for auth user ${userData.user.id}:`,
        profileError.message,
      );
    }
    return null;
  }
  return profile as CallerProfile;
}
