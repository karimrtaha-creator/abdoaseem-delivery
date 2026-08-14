// Section 6, call center screen steps 1-5, plus customer self-checkout
// (customer-web). Creates (or reuses) the customer profile and the order +
// its line items in one server-side call. Prices are always re-fetched
// from menu_items/combo_offers here - a client-supplied price is never
// trusted, so a tampered request can't under-charge an order.
import { corsHeaders, jsonResponse, errorResponse, serveWithCors, dbErrorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { lookupSlaMinutes } from "../_shared/sla.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface CartItem {
  menu_item_id?: number;
  combo_offer_id?: number;
  quantity: number;
  combo_choice_option_ids?: number[];
  note?: string;
}

// Security audit finding M-02: quantity used to be checked with just
// `!item.quantity || item.quantity <= 0`, which passed decimals (1.5),
// non-integers coerced to true-ish, and anything huge - a malformed
// quantity (1.5, 1e308) got past this check and used to fail later at the
// order_items insert, orphaning the just-created orders row (closed
// architecturally by 0056's atomic create_order_with_items - see below).
// This business maximum (20/line) is a placeholder pending a real number
// from Karim; easy to change in one place.
const MAX_ITEM_QUANTITY = 20;

// Cairo-local "HH:MM" for the current instant - the server itself runs in
// UTC, and Egypt's offset isn't hardcoded here on purpose (DST history has
// been inconsistent), so this always asks the platform for the real
// current offset instead of assuming one.
function nowInCairo(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

// The configured window can wrap midnight (e.g. opens 08:00, closes 03:00
// the next day), so "open" isn't a simple opens <= now <= closes range -
// when closes < opens, the closed period is the short gap between them.
function isWithinBusinessHours(nowHHMM: string, opensAt: string, closesAt: string): boolean {
  const opens = opensAt.slice(0, 5);
  const closes = closesAt.slice(0, 5);
  if (closes < opens) return nowHHMM >= opens || nowHHMM < closes;
  return nowHHMM >= opens && nowHHMM < closes;
}

interface CreateOrderBody {
  customer_phone?: string;
  customer_name?: string;
  address?: { building?: string; floor?: string; apartment?: string; area?: string };
  address_id?: number;
  branch_id?: number;
  items?: CartItem[];
  payment_method?: "cash" | "instapay_transfer";
  payment_proof_url?: string;
}

// Re-fetches every referenced item/combo's current price server-side,
// inserts the order + its line items, and returns the HTTP response.
// Shared by both the customer self-checkout path and the call_center
// path below - the only difference between them is how order_source/
// customer_id/branch_id/address_id get decided beforehand.
async function finishOrder(
  admin: SupabaseClient,
  args: {
    order_source: "customer_app" | "call_center";
    branch_id: number;
    customer_id: string;
    customer_phone: string;
    address_id: number | null;
    items: CartItem[];
    paymentMethod: "cash" | "instapay_transfer";
    paymentProofUrl: string | null;
    redirectedFrom?: string | null;
    servingBranchName?: string;
    deliveryFeeOverride?: number | null;
    // Website orders only - the customer's selected delivery zone's name.
    // Never set for call_center (that path's delivery_service comes from
    // the dispatcher's OCR-confirm step at photograph time instead).
    zoneName?: string | null;
  },
): Promise<Response> {
  const menuItemIds = args.items.filter((i) => i.menu_item_id != null).map((i) => i.menu_item_id as number);
  const comboIds = args.items.filter((i) => i.combo_offer_id != null).map((i) => i.combo_offer_id as number);

  const [menuItemsRes, combosRes] = await Promise.all([
    menuItemIds.length
      ? admin.from("menu_items").select("id, price, is_available").in("id", menuItemIds)
      : Promise.resolve({ data: [], error: null }),
    comboIds.length
      ? admin.from("combo_offers").select("id, price, is_active").in("id", comboIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (menuItemsRes.error) return dbErrorResponse("create-order", menuItemsRes.error.message);
  if (combosRes.error) return dbErrorResponse("create-order", combosRes.error.message);

  const menuItemPrices = new Map((menuItemsRes.data ?? []).map((m) => [m.id, m]));
  const comboPrices = new Map((combosRes.data ?? []).map((c) => [c.id, c]));

  // Combo choices are re-resolved server-side the same way prices are -
  // the client sends option ids, never the label text, and this fetches
  // every choice group + option for the combos actually being ordered so
  // each selection can be validated (belongs to the right combo, exactly
  // one option per group) before building the human-readable summary that
  // gets stored on the order line.
  const { data: choiceGroupsData, error: choiceGroupsError } = comboIds.length
    ? await admin
        .from("combo_choice_groups")
        .select("id, combo_offer_id, label, combo_choice_options(id, label, is_available)")
        .in("combo_offer_id", comboIds)
    : { data: [], error: null };
  if (choiceGroupsError) return dbErrorResponse("create-order", choiceGroupsError.message);
  const choiceGroupsByCombo = new Map<
    number,
    { id: number; label: string; combo_choice_options: { id: number; label: string; is_available: boolean }[] }[]
  >();
  for (const group of choiceGroupsData ?? []) {
    const list = choiceGroupsByCombo.get(group.combo_offer_id) ?? [];
    list.push(group);
    choiceGroupsByCombo.set(group.combo_offer_id, list);
  }

  const orderItemsToInsert: {
    menu_item_id: number | null;
    combo_offer_id: number | null;
    quantity: number;
    unit_price: number;
    combo_selection: string | null;
    note: string | null;
  }[] = [];

  for (const item of args.items) {
    // Free text, never interpreted - just capped so nobody can stuff an
    // essay into a single order line.
    const note = item.note?.trim().slice(0, 200) || null;

    if (item.menu_item_id != null) {
      const found = menuItemPrices.get(item.menu_item_id);
      if (!found) return errorResponse(`menu_item_id ${item.menu_item_id} not found`, 422);
      if (!found.is_available) return errorResponse(`menu_item_id ${item.menu_item_id} is not available`, 422);
      orderItemsToInsert.push({
        menu_item_id: item.menu_item_id,
        combo_offer_id: null,
        quantity: item.quantity,
        unit_price: found.price,
        combo_selection: null,
        note,
      });
    } else {
      const found = comboPrices.get(item.combo_offer_id as number);
      if (!found) return errorResponse(`combo_offer_id ${item.combo_offer_id} not found`, 422);
      if (!found.is_active) return errorResponse(`combo_offer_id ${item.combo_offer_id} is not active`, 422);

      const groups = choiceGroupsByCombo.get(item.combo_offer_id as number) ?? [];
      let comboSelection: string | null = null;
      if (groups.length > 0) {
        const providedIds = new Set(item.combo_choice_option_ids ?? []);
        const parts: string[] = [];
        for (const group of groups) {
          const matches = group.combo_choice_options.filter((o) => providedIds.has(o.id));
          if (matches.length !== 1) {
            return errorResponse(`combo_offer_id ${item.combo_offer_id}: exactly one option required for '${group.label}'`, 422);
          }
          // Re-checked here, not just hidden client-side - a disabled
          // option (manage via المنيو's per-option toggle) must be
          // unselectable even if a stale/tampered client still sends it.
          if (!matches[0].is_available) {
            return errorResponse(
              `combo_offer_id ${item.combo_offer_id}: option '${matches[0].label}' is not available`,
              422,
            );
          }
          parts.push(`${group.label}: ${matches[0].label}`);
        }
        comboSelection = parts.join(" | ");
      }

      orderItemsToInsert.push({
        menu_item_id: null,
        combo_offer_id: item.combo_offer_id as number,
        quantity: item.quantity,
        unit_price: found.price,
        combo_selection: comboSelection,
        note,
      });
    }
  }

  // Delivery fee: prefer the address's specific zone fee (delivery_zones,
  // 0024/0025 - real per-street pricing from the owner) when the address
  // has one; branches.delivery_fee (general_manager-managed,
  // BranchManagement.tsx) is the fallback for addresses/branches with no
  // zone data yet. Never something the client can set - re-fetched here
  // the same "never trust the client" way prices/branch routing are.
  let deliveryFee = args.deliveryFeeOverride ?? null;
  if (deliveryFee == null) {
    const { data: feeBranch, error: feeBranchError } = await admin
      .from("branches")
      .select("delivery_fee")
      .eq("id", args.branch_id)
      .single();
    if (feeBranchError) return dbErrorResponse("create-order", feeBranchError.message);
    deliveryFee = feeBranch?.delivery_fee ?? 0;
  }

  // delivery_service + delivery_time_minutes (2026-08-11): website orders
  // get both up front, the same moment the delivery fee is known - the
  // zone the customer picked is the "service", and the same SLA-tier
  // lookup dispatch-order already uses for this branch/fee combination
  // gives a real delivery-time estimate this early. call_center orders
  // deliberately get neither here - see photograph-order for why.
  let deliveryService: string | null = null;
  let deliveryTimeMinutes: number | null = null;
  if (args.order_source === "customer_app") {
    deliveryService = args.zoneName ?? null;
    deliveryTimeMinutes = await lookupSlaMinutes(admin, deliveryFee, args.branch_id);
  }

  // Order + its line items are created in one atomic call (0056) - the
  // order row and every order_items row either all commit together or
  // none of them do, closing the orphan-order gap two separate inserts
  // used to leave open when the second one failed.
  const { data: orderId, error: createError } = await admin.rpc("create_order_with_items", {
    p_order_source: args.order_source,
    p_branch_id: args.branch_id,
    p_customer_id: args.customer_id,
    p_customer_phone: args.customer_phone,
    p_address_id: args.address_id,
    p_payment_method: args.paymentMethod,
    p_payment_proof_url: args.paymentProofUrl,
    p_delivery_fee: deliveryFee,
    p_delivery_service: deliveryService,
    p_delivery_time_minutes: deliveryTimeMinutes,
    p_items: orderItemsToInsert.map((i) => ({
      menu_item_id: i.menu_item_id,
      combo_offer_id: i.combo_offer_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      combo_selection: i.combo_selection,
      note: i.note,
    })),
  });
  if (createError || orderId == null) {
    return dbErrorResponse("create-order", createError?.message ?? "create_order_with_items returned no id");
  }

  return jsonResponse({
    order_id: orderId,
    status: "pending_acceptance",
    items_count: orderItemsToInsert.length,
    redirected_from: args.redirectedFrom ?? null,
    serving_branch_name: args.servingBranchName ?? null,
    delivery_fee: deliveryFee,
  });
}

serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  const isSelfCheckout = caller.role === "customer";
  if (!isSelfCheckout && !["call_center", "general_manager", "team_leader"].includes(caller.role)) {
    return errorResponse("only call_center/team_leader/general_manager can create phone orders", 403);
  }

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }

  const items = body.items ?? [];
  const paymentMethod = body.payment_method;

  if (items.length === 0) return errorResponse("items must be a non-empty array");
  if (!paymentMethod || !["cash", "instapay_transfer"].includes(paymentMethod)) {
    return errorResponse("payment_method must be 'cash' or 'instapay_transfer'");
  }
  if (paymentMethod === "instapay_transfer" && !body.payment_proof_url) {
    return errorResponse("payment_proof_url is required when payment_method is instapay_transfer");
  }
  for (const item of items) {
    const hasMenuItem = item.menu_item_id != null;
    const hasCombo = item.combo_offer_id != null;
    if (hasMenuItem === hasCombo) {
      return errorResponse("each item must have exactly one of menu_item_id or combo_offer_id");
    }
    if (
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_ITEM_QUANTITY
    ) {
      return errorResponse(`each item needs an integer quantity between 1 and ${MAX_ITEM_QUANTITY}`);
    }
  }

  const admin = getAdminClient();

  // Finding #001: 10 orders / 5 minutes per caller - generous enough for
  // a legitimate customer retrying a failed checkout a few times, tight
  // enough to stop a script from flooding pending_acceptance with fake
  // orders. call_center staff share this same per-caller budget (their
  // own account, not per-guest-customer, since one agent phones in many
  // customers' orders back-to-back as their actual job).
  const withinLimit = await checkRateLimit(admin, "create-order", caller.id, 300, 10);
  if (!withinLimit) return errorResponse("too many orders created recently - wait a bit and try again", 429);

  // Applies to both the customer self-checkout path and the call_center
  // phone-order path - the owner wants the site closed to new orders
  // outside these hours regardless of who's placing it.
  const { data: hours, error: hoursError } = await admin
    .from("business_hours")
    .select("opens_at, closes_at")
    .eq("id", 1)
    .single();
  if (hoursError || !hours) return errorResponse(hoursError?.message ?? "business hours not configured", 500);
  if (!isWithinBusinessHours(nowInCairo(), hours.opens_at, hours.closes_at)) {
    return errorResponse("outside business hours", 422);
  }

  // Self-checkout: the caller IS the customer (already authenticated, no
  // phone-lookup/guest-account dance needed like the call_center path
  // below). They pick one of their own saved customer_addresses rather
  // than an agent typing a fresh address over the phone - branch_id is
  // derived from that address's nearest_branch_id, never taken from the
  // client directly, same "never trust the client for anything
  // authorization/routing-relevant" rule as the price re-fetch above.
  if (isSelfCheckout) {
    if (!body.address_id) return errorResponse("address_id is required");
    const { data: address, error: addressError } = await admin
      .from("customer_addresses")
      .select("id, user_id, nearest_branch_id, zone_id")
      .eq("id", body.address_id)
      .single();
    if (addressError || !address) return errorResponse("address not found", 404);
    if (address.user_id !== caller.id) return errorResponse("this address does not belong to you", 403);
    if (!address.nearest_branch_id) return errorResponse("this address has no nearest branch set", 422);

    let zoneDeliveryFee: number | null = null;
    let zoneName: string | null = null;
    if (address.zone_id) {
      const { data: zone, error: zoneError } = await admin
        .from("delivery_zones")
        .select("delivery_fee, zone_name, is_active")
        .eq("id", address.zone_id)
        .single();
      if (zoneError) return dbErrorResponse("create-order", zoneError.message);
      // A zone can be disabled (manage-delivery-zone) after an address
      // saved it - treat that exactly like "no zone_id set" rather than
      // silently charging a retired zone's fee, falling through to the
      // branch's flat delivery_fee below like any zone-less address.
      if (zone?.is_active) {
        zoneDeliveryFee = zone.delivery_fee;
        zoneName = zone.zone_name;
      }
    }

    const { data: branch, error: branchError } = await admin
      .from("branches")
      .select("id, name, is_delivery_available, delivery_fallback_branch_id")
      .eq("id", address.nearest_branch_id)
      .single();
    if (branchError || !branch) return errorResponse("branch not found", 404);

    let servingBranch = branch;
    let redirectedFrom: string | null = null;

    // Some branches are dine-in/takeaway only (e.g. المراغي, شارع 7) but
    // still have a sister branch that covers their delivery area
    // (delivery_fallback_branch_id, see 0014) - route the order there
    // instead of failing, and tell the caller so the customer sees why.
    if (!branch.is_delivery_available) {
      if (!branch.delivery_fallback_branch_id) return errorResponse("this branch does not offer delivery", 422);
      const { data: fallbackBranch, error: fallbackError } = await admin
        .from("branches")
        .select("id, name, is_delivery_available")
        .eq("id", branch.delivery_fallback_branch_id)
        .single();
      if (fallbackError || !fallbackBranch || !fallbackBranch.is_delivery_available) {
        return errorResponse("this branch does not offer delivery", 422);
      }
      servingBranch = { ...fallbackBranch, delivery_fallback_branch_id: null };
      redirectedFrom = branch.name;
    }

    return await finishOrder(admin, {
      order_source: "customer_app",
      branch_id: servingBranch.id,
      customer_id: caller.id,
      customer_phone: caller.phone ?? "",
      address_id: address.id,
      items,
      paymentMethod,
      paymentProofUrl: body.payment_proof_url ?? null,
      redirectedFrom,
      servingBranchName: servingBranch.name,
      deliveryFeeOverride: zoneDeliveryFee,
      zoneName,
    });
  }

  const customerPhone = body.customer_phone?.trim();
  const branchId = body.branch_id;

  if (!customerPhone) return errorResponse("customer_phone is required");
  if (!branchId) return errorResponse("branch_id is required");

  const { data: branch, error: branchError } = await admin
    .from("branches")
    .select("id, is_delivery_available")
    .eq("id", branchId)
    .single();
  if (branchError || !branch) return errorResponse("branch not found", 404);
  if (!branch.is_delivery_available) return errorResponse("this branch does not offer delivery", 422);

  // Find or create the customer. public.users.id is a foreign key into
  // auth.users(id) (confirmed live: inserting a bare random uuid fails with
  // "violates foreign key constraint users_id_fkey"), so a brand-new guest
  // customer needs a real auth user created first via the admin API - a
  // synthetic email (same idea as staff logins, different domain so a
  // phone number can never collide between the two) and a random password
  // they don't know. They can't log in with it today; that's fine, nothing
  // here promises them a login, only an order record. This project also
  // has an existing auth.users -> public.users trigger (observed when the
  // call_center test account was created) that auto-inserts a blank
  // public.users row the moment the auth user exists, defaulted to
  // role='customer' - so the row already exists by the time we get here
  // and must be UPDATEd, not INSERTed.
  let customerId: string;
  const { data: existingCustomer, error: findError } = await admin
    .from("users")
    .select("id")
    .eq("phone", customerPhone)
    .eq("role", "customer")
    .maybeSingle();
  if (findError) return dbErrorResponse("create-order", findError.message);

  if (existingCustomer) {
    customerId = existingCustomer.id;
    if (body.address) {
      await admin
        .from("customers_profile")
        .update({ ...body.address, nearest_branch_id: branchId })
        .eq("user_id", customerId);
    }
  } else {
    const guestEmail = `${customerPhone.replace(/\D/g, "")}@guest.abdoaseem.internal`;
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: guestEmail,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (authError || !authUser?.user) {
      return errorResponse(`failed to create customer account: ${authError?.message}`, 500);
    }
    customerId = authUser.user.id;

    // Defensive: normally an existing auth->public.users trigger already
    // created a blank row by this point (UPDATE is the right call), but
    // don't assume it - fall back to INSERT if nothing was there to update.
    const profileFields = {
      name: body.customer_name ?? "",
      phone: customerPhone,
      role: "customer",
      is_active: true,
    };
    const { data: updatedRows, error: updateUserError } = await admin
      .from("users")
      .update(profileFields)
      .eq("id", customerId)
      .select("id");
    if (updateUserError) return dbErrorResponse("create-order", updateUserError.message);
    if (!updatedRows || updatedRows.length === 0) {
      const { error: insertUserError } = await admin.from("users").insert({ id: customerId, ...profileFields });
      if (insertUserError) return dbErrorResponse("create-order", insertUserError.message);
    }

    const { error: createProfileError } = await admin.from("customers_profile").insert({
      user_id: customerId,
      building: body.address?.building ?? null,
      floor: body.address?.floor ?? null,
      apartment: body.address?.apartment ?? null,
      area: body.address?.area ?? null,
      nearest_branch_id: branchId,
    });
    if (createProfileError) return dbErrorResponse("create-order", createProfileError.message);
  }

  return await finishOrder(admin, {
    order_source: "call_center",
    branch_id: branchId,
    customer_id: customerId,
    customer_phone: customerPhone,
    address_id: null,
    items,
    paymentMethod,
    paymentProofUrl: body.payment_proof_url ?? null,
  });
});
