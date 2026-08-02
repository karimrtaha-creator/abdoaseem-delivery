import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Section 4 / 9: sla_minutes is looked up from sla_tiers by
// delivery_fee_after_tax, never computed from distance/GPS.
export async function lookupSlaMinutes(
  admin: SupabaseClient,
  deliveryFeeAfterTax: number,
): Promise<number> {
  const { data, error } = await admin
    .from("sla_tiers")
    .select("tier_id, min_price, max_price, sla_minutes")
    .lte("min_price", deliveryFeeAfterTax)
    .gte("max_price", deliveryFeeAfterTax)
    .order("tier_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`sla_tiers lookup failed: ${error.message}`);
  if (!data) {
    throw new Error(
      `no sla_tiers row covers delivery_fee_after_tax=${deliveryFeeAfterTax}`,
    );
  }
  return data.sla_minutes as number;
}

export function minutesBetween(from: string | Date, to: string | Date): number {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  return Math.round((toMs - fromMs) / 60000);
}

// 6 real random digits, not all-identical and not a simple ascending/
// descending run (weak codes like 000000 / 123456 / 654321).
export function generateOtpCode(): string {
  const isWeak = (code: string) => {
    if (/^(\d)\1{5}$/.test(code)) return true;
    const digits = code.split("").map(Number);
    const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
    const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
    return ascending || descending;
  };

  let code: string;
  do {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    code = String(bytes[0] % 1_000_000).padStart(6, "0");
  } while (isWeak(code));
  return code;
}
