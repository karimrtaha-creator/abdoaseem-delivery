// Section 5 channel order: app push (Firebase) -> WhatsApp Business API ->
// SMS (mandatory fallback). None of these providers are configured yet
// (no Firebase server key, WhatsApp/Twilio credentials, or device-token
// storage exist in the current schema/env) - so this module is a thin,
// swappable adapter layer, not a real integration. Every branch is a no-op
// that just logs, so nothing here can silently fail in a misleading way.

export async function alertManagersOrderDelayed(orderId: number, branchId: number): Promise<void> {
  // Section 4: "instant alert" when an order breaches SLA while still in
  // transit. Real implementation needs FCM device tokens for
  // branch/regional/general managers, which the schema doesn't store yet.
  console.warn(`[notify] order ${orderId} (branch ${branchId}) breached SLA - manager push not configured`);
}
