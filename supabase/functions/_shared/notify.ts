// Section 5 channel order: app push (Firebase) -> WhatsApp Business API ->
// SMS (mandatory fallback). None of these providers are configured yet
// (no Firebase server key, WhatsApp/Twilio credentials, or device-token
// storage exist in the current schema/env) - so this module is a thin,
// swappable adapter layer, not a real integration. Every branch is a no-op
// that just logs, so nothing here can silently fail in a misleading way.
//
// TODO before this is real: add an `fcm_token` column (users or a new
// `device_tokens` table) for the push branch, and set SMS_PROVIDER /
// WHATSAPP_* secrets for the other two.

export interface OtpSendResult {
  channel: "app_push" | "whatsapp" | "sms" | "none";
  sent: boolean;
}

export async function sendOtpToCustomer(
  customerPhone: string,
  code: string,
  orderId: number,
): Promise<OtpSendResult> {
  const smsProvider = Deno.env.get("SMS_PROVIDER");

  if (!smsProvider) {
    console.warn(
      `[notify] SMS_PROVIDER not configured - OTP for order ${orderId} was NOT sent to ${customerPhone}. ` +
        `Running in test mode: the code is returned in the API response for manual QA only.`,
    );
    return { channel: "none", sent: false };
  }

  // Real SMS send would go here (Vodafone/Orange/Twilio API call using
  // SMS_PROVIDER + related secrets). Left unimplemented until the provider
  // and its credentials are chosen - see TODO above.
  console.log(`[notify] would send SMS via ${smsProvider} to ${customerPhone} for order ${orderId}`);
  return { channel: "sms", sent: false };
}

export async function alertManagersOrderDelayed(orderId: number, branchId: number): Promise<void> {
  // Section 4: "instant alert" when an order breaches SLA while still in
  // transit. Real implementation needs FCM device tokens for
  // branch/regional/general managers, which the schema doesn't store yet.
  console.warn(`[notify] order ${orderId} (branch ${branchId}) breached SLA - manager push not configured`);
}
