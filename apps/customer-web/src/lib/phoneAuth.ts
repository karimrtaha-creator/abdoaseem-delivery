// Same synthetic-email convention used everywhere else in this project
// (apps/dispatcher-web, apps/driver_app, create-order's guest customers) -
// but on its own domain so a phone number can never collide between a
// self-registered customer, a guest customer created by call_center, and
// staff:
//   staff:                <phone>@abdoaseem.internal
//   guest (call_center):  <phone>@guest.abdoaseem.internal
//   self-registered:      <phone>@customer.abdoaseem.internal
const CUSTOMER_EMAIL_DOMAIN = "customer.abdoaseem.internal";

export function phoneToCustomerEmail(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, "");
  return `${digitsOnly}@${CUSTOMER_EMAIL_DOMAIN}`;
}
