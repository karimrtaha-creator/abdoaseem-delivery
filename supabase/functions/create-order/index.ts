// Section 6, call center screen steps 1-5. Creates (or reuses) the
// customer profile and the order + its line items in one server-side call.
// Prices are always re-fetched from menu_items/combo_offers here - a
// client-supplied price is never trusted, so a tampered request can't
// under-charge an order.
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getAdminClient, getCaller } from "../_shared/auth.ts";

interface CartItem {
  menu_item_id?: number;
  combo_offer_id?: number;
  quantity: number;
}

interface CreateOrderBody {
  customer_phone?: string;
  customer_name?: string;
  address?: { building?: string; floor?: string; apartment?: string; area?: string };
  branch_id?: number;
  items?: CartItem[];
  payment_method?: "cash" | "instapay_transfer";
  payment_proof_url?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const caller = await getCaller(req);
  if (!caller || !caller.is_active) return errorResponse("unauthorized", 401);
  if (!["call_center", "general_manager", "team_leader"].includes(caller.role)) {
    return errorResponse("only call_center/team_leader/general_manager can create phone orders", 403);
  }

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body");
  }

  const customerPhone = body.customer_phone?.trim();
  const branchId = body.branch_id;
  const items = body.items ?? [];
  const paymentMethod = body.payment_method;

  if (!customerPhone) return errorResponse("customer_phone is required");
  if (!branchId) return errorResponse("branch_id is required");
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
    if (!item.quantity || item.quantity <= 0) {
      return errorResponse("each item needs a quantity > 0");
    }
  }

  const admin = getAdminClient();

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
  if (findError) return errorResponse(findError.message, 500);

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
    if (updateUserError) return errorResponse(updateUserError.message, 500);
    if (!updatedRows || updatedRows.length === 0) {
      const { error: insertUserError } = await admin.from("users").insert({ id: customerId, ...profileFields });
      if (insertUserError) return errorResponse(insertUserError.message, 500);
    }

    const { error: createProfileError } = await admin.from("customers_profile").insert({
      user_id: customerId,
      building: body.address?.building ?? null,
      floor: body.address?.floor ?? null,
      apartment: body.address?.apartment ?? null,
      area: body.address?.area ?? null,
      nearest_branch_id: branchId,
    });
    if (createProfileError) return errorResponse(createProfileError.message, 500);
  }

  // Re-fetch every referenced item/combo's current price server-side.
  const menuItemIds = items.filter((i) => i.menu_item_id != null).map((i) => i.menu_item_id as number);
  const comboIds = items.filter((i) => i.combo_offer_id != null).map((i) => i.combo_offer_id as number);

  const [menuItemsRes, combosRes] = await Promise.all([
    menuItemIds.length
      ? admin.from("menu_items").select("id, price, is_available").in("id", menuItemIds)
      : Promise.resolve({ data: [], error: null }),
    comboIds.length
      ? admin.from("combo_offers").select("id, price, is_active").in("id", comboIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (menuItemsRes.error) return errorResponse(menuItemsRes.error.message, 500);
  if (combosRes.error) return errorResponse(combosRes.error.message, 500);

  const menuItemPrices = new Map((menuItemsRes.data ?? []).map((m) => [m.id, m]));
  const comboPrices = new Map((combosRes.data ?? []).map((c) => [c.id, c]));

  const orderItemsToInsert: {
    menu_item_id: number | null;
    combo_offer_id: number | null;
    quantity: number;
    unit_price: number;
  }[] = [];

  for (const item of items) {
    if (item.menu_item_id != null) {
      const found = menuItemPrices.get(item.menu_item_id);
      if (!found) return errorResponse(`menu_item_id ${item.menu_item_id} not found`, 422);
      if (!found.is_available) return errorResponse(`menu_item_id ${item.menu_item_id} is not available`, 422);
      orderItemsToInsert.push({
        menu_item_id: item.menu_item_id,
        combo_offer_id: null,
        quantity: item.quantity,
        unit_price: found.price,
      });
    } else {
      const found = comboPrices.get(item.combo_offer_id as number);
      if (!found) return errorResponse(`combo_offer_id ${item.combo_offer_id} not found`, 422);
      if (!found.is_active) return errorResponse(`combo_offer_id ${item.combo_offer_id} is not active`, 422);
      orderItemsToInsert.push({
        menu_item_id: null,
        combo_offer_id: item.combo_offer_id as number,
        quantity: item.quantity,
        unit_price: found.price,
      });
    }
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      order_source: "call_center",
      branch_id: branchId,
      customer_id: customerId,
      customer_phone: customerPhone,
      status: "pending_acceptance",
      order_time: new Date().toISOString(),
      payment_method: paymentMethod,
      payment_proof_url: body.payment_proof_url ?? null,
    })
    .select("id")
    .single();
  if (orderError || !order) return errorResponse(orderError?.message ?? "failed to create order", 500);

  const { error: itemsError } = await admin
    .from("order_items")
    .insert(orderItemsToInsert.map((i) => ({ ...i, order_id: order.id })));
  if (itemsError) {
    return errorResponse(`order created (id=${order.id}) but items failed: ${itemsError.message}`, 500);
  }

  return jsonResponse({ order_id: order.id, status: "pending_acceptance", items_count: orderItemsToInsert.length });
});
