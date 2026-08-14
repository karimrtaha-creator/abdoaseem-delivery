// Section 6, call center screen step 1: "البحث عن العميل برقم الموبايل -
// لو موجود قبل كده، تظهر بياناته وعناوينه المحفوظة تلقائيًا". Routed
// through a function (rather than a client-side users SELECT policy) so
// customer PII lookup by phone stays server-side and audited, same as
// every other sensitive read in this project.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["call_center", "general_manager", "team_leader"].includes(caller.role)) {
    return errorResponse("only call_center/team_leader/general_manager can look up customers", 403);
  }

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }
  const phone = body.phone?.trim();
  if (!phone) return errorResponse("phone is required");

  const admin = getAdminClient();
  const { data: customer, error: customerError } = await admin
    .from("users")
    .select("id, name, phone")
    .eq("phone", phone)
    .eq("role", "customer")
    .maybeSingle();
  if (customerError) return dbErrorResponse("lookup-customer", customerError.message);
  if (!customer) return jsonResponse({ found: false });

  const { data: profile } = await admin
    .from("customers_profile")
    .select("building, floor, apartment, area, nearest_branch_id")
    .eq("user_id", customer.id)
    .maybeSingle();

  return jsonResponse({
    found: true,
    customer_id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: profile ?? null,
  });
});
