// Staff sign in with their phone number; Supabase Auth only has the email
// provider enabled on this project, so we map phone -> a synthetic email
// deterministically. Whatever creates staff accounts (Phase 3 admin tool)
// must use this exact same mapping.
const STAFF_EMAIL_DOMAIN = "abdoaseem.internal";

export function phoneToStaffEmail(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, "");
  return `${digitsOnly}@${STAFF_EMAIL_DOMAIN}`;
}
