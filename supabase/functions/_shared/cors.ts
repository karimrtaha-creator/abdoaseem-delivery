// Finding #004 (security audit): Access-Control-Allow-Origin used to be a
// hardcoded "*" - any website could call these endpoints from a browser
// using a logged-in user's own session/token (CSRF-style abuse via fetch).
// Now the allowed origins come from the ALLOWED_ORIGINS secret (comma-
// separated), falling back to the two local dev ports every app in this
// repo runs on if that secret isn't set yet. There is no production
// customer-web/dispatcher-web domain deployed yet - once there is, add it
// to ALLOWED_ORIGINS (a secret update, no redeploy needed) and this starts
// enforcing it immediately. The Flutter driver app and pg_cron never send
// an Origin header at all, so they're unaffected either way.
const DEFAULT_DEV_ORIGINS = ["http://localhost:5173", "http://localhost:5174"];

function resolveAllowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (configured && configured.trim()) {
    return configured.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return DEFAULT_DEV_ORIGINS;
}

function originForRequest(req: Request): string {
  const requestOrigin = req.headers.get("origin");
  const allowed = resolveAllowedOrigins();
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  // No Origin header (mobile app, pg_cron, curl) or an origin not on the
  // list - echoing the first allowed origin here is harmless: a real
  // browser enforces CORS against the ACTUAL page origin it's running on,
  // not against whatever string this header happens to contain, so a
  // disallowed origin still gets blocked client-side.
  return allowed[0];
}

export const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Every handler's Deno.serve(async (req) => {...}) becomes
// serveWithCors(async (req) => {...}) - same body, unchanged - so the
// correct per-request Access-Control-Allow-Origin gets set on every
// response (including error responses and the OPTIONS preflight) without
// threading `req` through every individual jsonResponse/errorResponse call.
export function serveWithCors(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    const response = await handler(req);
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", originForRequest(req));
    headers.set("Vary", "Origin");
    return new Response(response.body, { status: response.status, headers });
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// Karim's explicit instruction (2026-08-11, dispatcher-photo-gate feature):
// dispatcher must do 100% of their work through the mobile app, never
// dispatcher-web, and that has to be enforced server-side, not just by
// removing the tab. The real, unconditional security boundary is DATA
// access (RLS/branch/photo-existence scoping, unaffected by which client
// calls it - a valid bearer token has the same capabilities no matter what
// app sends it, that's how bearer-token APIs work everywhere). This is a
// SEPARATE, softer signal on top of that: browsers always send an Origin
// header on fetch/XHR calls (see corsHeaders comment above); Flutter/Dart's
// HTTP client, like any native mobile client, never sends one. So an
// Origin header present on a request from a `dispatcher`-role caller means
// it almost certainly came from a browser tab (dispatcher-web or devtools)
// rather than the mobile app - reject those specifically. Disclosed
// honestly: this is a best-effort client-identification heuristic, not a
// cryptographic guarantee - a sufficiently deliberate attacker with a valid
// dispatcher token could strip the header via curl. It reliably blocks the
// actual scenario being guarded against (a dispatcher using dispatcher-web
// normally in a browser) without being oversold as more than that.
export function isBrowserRequest(req: Request): boolean {
  return req.headers.get("origin") !== null;
}
