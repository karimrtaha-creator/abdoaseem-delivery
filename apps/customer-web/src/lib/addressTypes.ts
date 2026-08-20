export interface CustomerAddress {
  id: number;
  user_id: string;
  label: string | null;
  street: string | null;
  building: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
  area: string | null;
  main_region_id: number | null;
  nearest_branch_id: number | null;
  zone_id: number | null;
  alt_phone: string | null;
  alt_phone_has_whatsapp: boolean;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export interface Region {
  id: number;
  name: string;
}

export interface Branch {
  id: number;
  name: string;
  region_id: number;
  is_delivery_available?: boolean;
  is_active?: boolean;
  delivery_fallback_branch_id?: number | null;
  delivery_fee?: number;
}

// Security audit finding MEDIUM-1 (Batch 6): delivery_fee deliberately isn't
// part of this browse/search shape anymore - it's fetched one zone at a time
// via the get_zone_delivery_fee RPC only once a zone is actually selected,
// never bulk-loaded alongside every zone's name (see Addresses.tsx).
export interface DeliveryZone {
  id: number;
  branch_id: number;
  zone_name: string;
}

// The branch that will actually fulfil an address's order - if the
// nearest branch doesn't deliver, follows delivery_fallback_branch_id
// (same rule create-order enforces server-side, see migration 0014).
export function resolveServingBranch(nearestBranchId: number | null, branches: Branch[]): Branch | null {
  const nearest = branches.find((b) => b.id === nearestBranchId);
  if (!nearest) return null;
  if (nearest.is_delivery_available !== false) return nearest;
  if (!nearest.delivery_fallback_branch_id) return null;
  return branches.find((b) => b.id === nearest.delivery_fallback_branch_id) ?? null;
}

export function formatAddressSummary(addr: CustomerAddress, regions: Region[], branches: Branch[]): string {
  const region = regions.find((r) => r.id === addr.main_region_id)?.name;
  const branch = branches.find((b) => b.id === addr.nearest_branch_id)?.name;
  const parts = [addr.street && `شارع ${addr.street}`, addr.building && `عمارة ${addr.building}`, region].filter(Boolean);
  return parts.length ? parts.join(" - ") : branch ?? "عنوان بدون تفاصيل";
}
