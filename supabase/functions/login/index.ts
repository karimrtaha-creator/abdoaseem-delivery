// Security audit finding M-01 (2026-08-14): neither app ever routed
// password sign-in through an edge function - both called
// supabase.auth.signInWithPassword() directly - so nothing server-side
// this project controls ever saw a login attempt to throttle. Live-
// confirmed: 25 consecutive wrong-password attempts against one account
// all returned HTTP 400 with no throttling whatsoever.
//
// Tried wiring Supabase Auth's native "Password Verification Attempt"
// hook first (would have needed zero frontend changes) - the platform
// rejected configuring it with an HTTP 402 ("cannot be configured for
// this organization"), a paid-plan gate, not something fixable in code.
// This function is the fallback: both apps now call it instead of
// signInWithPassword directly (see supabaseClient usage in
// AuthContext.tsx / Login.tsx), and it proxies straight through to
// Supabase Auth's own token endpoint after an existing-architecture
// checkRateLimit() gate.
//
// Also closes part of finding F-02 here specifically: GoTrue's raw error
// body is never returned to the client, only a generic invalid-
// credentials message - matches what both apps already showed before
// this change, so no visible behavior change for a normal wrong password.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || typeof password !== "string" || !password) {
    return errorResponse("email and password are required");
  }

  const admin = getAdminClient();

  // Per-account throttle, same fixed-window mechanism every other
  // rate-limited endpoint in this project already uses (0032). Keyed by
  // the email being attempted, not the caller's identity - there is no
  // caller identity yet, that's the whole point of a login endpoint.
  // Counts every attempt, right or wrong: a brute-force run's eventual
  // correct guess has to be capped too, or the limit protects nothing.
  // 5/300s is generous for a human mistyping their own password a few
  // times before getting it right, while capping online guessing against
  // one account at 5 real tries per 5 minutes. The window resets on its
  // own - this can never become a permanent lock someone has to clear.
  const withinLimit = await checkRateLimit(admin, "login-attempt", email, 300, 5);
  if (!withinLimit) {
    return errorResponse("too many login attempts - wait a few minutes and try again", 429);
  }

  const authResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!authResp.ok) {
    // Never echo GoTrue's own error body - same generic message
    // regardless of whether the account exists, matches what both apps
    // already showed before this change.
    return errorResponse("invalid email/phone or password", 401);
  }

  const authData = await authResp.json();
  return jsonResponse(authData);
});
