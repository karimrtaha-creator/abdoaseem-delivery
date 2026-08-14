// "المندوب قريب منك" - runs on a schedule (pg_cron, see migration 0030)
// exactly like check-sla-breaches: for every order currently out for
// delivery, compares the driver's live location (users.current_lat/lng,
// migration 0028) against the customer's saved delivery-address pin
// (customer_addresses.latitude/longitude) and pushes the customer once
// they're within PROXIMITY_METERS - never more than once per order
// (orders.proximity_alert_sent, migration 0029).
//
// Silently skips an order whenever either point is missing (driver
// hasn't sent a location yet, or the address was never pinned) - there's
// nothing wrong to report, just nothing to compare yet.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/auth.ts";
import { sendPush } from "../_shared/fcm.ts";

const PROXIMITY_METERS = 700;
const EARTH_RADIUS_METERS = 6_371_000;

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Same cron-only gate as check-sla-breaches - no per-user role to
  // check, only a known secret can invoke it.
  const authHeader = req.headers.get("Authorization") ?? "";
  const presentedToken = authHeader.replace(/^Bearer\s+/i, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authorized =
    (!!serviceRoleKey && presentedToken === serviceRoleKey) || (!!cronSecret && presentedToken === cronSecret);
  if (!authorized) return errorResponse("unauthorized", 401);

  const admin = getAdminClient();

  const { data: orders, error: ordersError } = await admin
    .from("orders")
    .select("id, pos_order_id, customer_id, driver_id, address_id")
    .in("status", ["out_for_delivery", "delayed"])
    .eq("proximity_alert_sent", false)
    .not("driver_id", "is", null)
    .not("address_id", "is", null);
  if (ordersError) return dbErrorResponse("check-driver-proximity", ordersError.message);
  if (!orders || orders.length === 0) return jsonResponse({ checked: 0, alerted: 0 });

  const driverIds = [...new Set(orders.map((o) => o.driver_id as string))];
  const addressIds = [...new Set(orders.map((o) => o.address_id as number))];

  const [driversRes, addressesRes] = await Promise.all([
    admin.from("users").select("id, current_lat, current_lng").in("id", driverIds),
    admin.from("customer_addresses").select("id, latitude, longitude").in("id", addressIds),
  ]);
  if (driversRes.error) return dbErrorResponse("check-driver-proximity", driversRes.error.message);
  if (addressesRes.error) return dbErrorResponse("check-driver-proximity", addressesRes.error.message);

  const driverById = new Map((driversRes.data ?? []).map((d) => [d.id, d]));
  const addressById = new Map((addressesRes.data ?? []).map((a) => [a.id, a]));

  const webUrl = Deno.env.get("CUSTOMER_WEB_URL");
  let alerted = 0;

  for (const order of orders) {
    const driver = driverById.get(order.driver_id as string);
    const address = addressById.get(order.address_id as number);
    if (!driver?.current_lat || !driver?.current_lng || !address?.latitude || !address?.longitude) continue;

    const distance = distanceMeters(driver.current_lat, driver.current_lng, address.latitude, address.longitude);
    if (distance > PROXIMITY_METERS) continue;

    const { data: customer } = await admin.from("users").select("fcm_token").eq("id", order.customer_id).single();
    if (customer?.fcm_token) {
      await sendPush(
        customer.fcm_token,
        "المندوب قريب منك",
        `المندوب قرّب من عنوانك لأوردر #${order.pos_order_id ?? order.id} - جهّز نفسك.`,
        { order_id: String(order.id), type: "driver_nearby" },
        webUrl ? `${webUrl}/orders` : undefined,
      );
    }
    await admin.from("orders").update({ proximity_alert_sent: true }).eq("id", order.id);
    alerted++;
  }

  return jsonResponse({ checked: orders.length, alerted });
});
