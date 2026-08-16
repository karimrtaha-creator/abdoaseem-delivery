import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Section 4 / 9: sla_minutes is looked up from sla_tiers by
// delivery_fee_after_tax, never computed from distance/GPS.
//
// sla_tiers is branch-scoped (0024) - most branches now have their own
// tier rows (2 real patterns from the owner's spreadsheet), but a branch
// with no tiers of its own (e.g. فرع مايو, still awaiting real numbers)
// falls back to the original branch_id IS NULL rows that predate this.
export async function lookupSlaMinutes(
  admin: SupabaseClient,
  deliveryFeeAfterTax: number,
  branchId: number,
): Promise<number> {
  // max_price IS NULL means "no upper limit" (the top, open-ended tier) -
  // a plain .gte("max_price", X) never matches a NULL column in SQL, so
  // that row was silently unreachable for every fee above the next-lower
  // tier's cutoff (found live 2026-08-13 verifying the delivery-zones
  // fallback path: 11 real sla_tiers rows across the system have
  // max_price IS NULL). Explicitly OR in "max_price IS NULL" alongside
  // the normal >= comparison so the open-ended tier can actually be hit.
  const { data: scoped, error: scopedError } = await admin
    .from("sla_tiers")
    .select("tier_id, min_price, max_price, sla_minutes")
    .eq("branch_id", branchId)
    .lte("min_price", deliveryFeeAfterTax)
    .or(`max_price.is.null,max_price.gte.${deliveryFeeAfterTax}`)
    .order("tier_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (scopedError) throw new Error(`sla_tiers lookup failed: ${scopedError.message}`);
  if (scoped) return scoped.sla_minutes as number;

  const { data: fallback, error: fallbackError } = await admin
    .from("sla_tiers")
    .select("tier_id, min_price, max_price, sla_minutes")
    .is("branch_id", null)
    .lte("min_price", deliveryFeeAfterTax)
    .or(`max_price.is.null,max_price.gte.${deliveryFeeAfterTax}`)
    .order("tier_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fallbackError) throw new Error(`sla_tiers lookup failed: ${fallbackError.message}`);
  if (!fallback) {
    throw new Error(
      `no sla_tiers row (branch ${branchId} or global) covers delivery_fee_after_tax=${deliveryFeeAfterTax}`,
    );
  }
  return fallback.sla_minutes as number;
}

export function minutesBetween(from: string | Date, to: string | Date): number {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  return Math.round((toMs - fromMs) / 60000);
}
