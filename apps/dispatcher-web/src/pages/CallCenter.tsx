import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

interface Branch {
  id: number;
  name: string;
  areas_covered: unknown;
}

interface MenuCategory {
  id: number;
  name: string;
  display_order: number;
}

interface MenuItem {
  id: number;
  category_id: number;
  name: string;
  price: number;
  is_available: boolean;
}

interface ComboOffer {
  id: number;
  name: string;
  description: string;
  price: number;
  is_active: boolean;
}

interface ComboChoiceOption {
  id: number;
  label: string;
  display_order: number;
}
interface ComboChoiceGroup {
  id: number;
  combo_offer_id: number;
  label: string;
  display_order: number;
  combo_choice_options: ComboChoiceOption[];
}

interface CartLine {
  key: string;
  menu_item_id?: number;
  combo_offer_id?: number;
  name: string;
  unit_price: number;
  quantity: number;
  comboChoiceOptionIds?: number[];
  comboChoiceLabels?: string[];
  note?: string;
}

interface Address {
  building: string;
  floor: string;
  apartment: string;
  area: string;
}

const emptyAddress: Address = { building: "", floor: "", apartment: "", area: "" };

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke(name, {
    body: body as any,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (error) {
    // FunctionsHttpError.message is a generic "non-2xx status code" string -
    // the actual server error text only lives in the raw response body via
    // .context, same as Checkout.tsx's translateServerError path.
    let serverMessage: string | null = null;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const responseBody = await context.clone().json();
        if (typeof responseBody?.error === "string") serverMessage = responseBody.error;
      } catch {
        // response body wasn't JSON - fall through to the generic message
      }
    }
    throw new Error(serverMessage ?? error.message);
  }
  return data as T;
}

function branchMatchesArea(branch: Branch, area: string): boolean {
  if (!area.trim() || !Array.isArray(branch.areas_covered)) return false;
  const needle = area.trim().toLowerCase();
  return (branch.areas_covered as unknown[]).some(
    (a) => typeof a === "string" && a.toLowerCase().includes(needle),
  );
}

export function CallCenter() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [combos, setCombos] = useState<ComboOffer[]>([]);
  const [comboChoiceGroups, setComboChoiceGroups] = useState<ComboChoiceGroup[]>([]);
  // combo_offer_id -> choice_group_id -> selected option id
  const [comboSelections, setComboSelections] = useState<Record<number, Record<number, number>>>({});

  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [customerFound, setCustomerFound] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState<Address>(emptyAddress);
  const [branchId, setBranchId] = useState<number | "">("");
  const [branchAutoSuggested, setBranchAutoSuggested] = useState(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "instapay_transfer">("cash");
  const [proofFile, setProofFile] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successOrderId, setSuccessOrderId] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("branches")
      .select("id, name, areas_covered")
      .eq("is_delivery_available", true)
      .order("name")
      .then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase
      .from("menu_categories")
      .select("id, name, display_order")
      .order("display_order")
      .then(({ data }) => setCategories((data as MenuCategory[]) ?? []));
    supabase
      .from("menu_items")
      .select("id, category_id, name, price, is_available")
      .eq("is_available", true)
      .then(({ data }) => setMenuItems((data as MenuItem[]) ?? []));
    supabase
      .from("combo_offers")
      .select("id, name, description, price, is_active")
      .eq("is_active", true)
      .then(({ data }) => setCombos((data as ComboOffer[]) ?? []));
    supabase
      .from("combo_choice_groups")
      .select("id, combo_offer_id, label, display_order, combo_choice_options(id, label, display_order)")
      .order("display_order")
      .then(({ data }) => setComboChoiceGroups((data as ComboChoiceGroup[]) ?? []));
  }, []);

  // Best-effort branch suggestion once the customer's area is known - the
  // agent can always override via the dropdown below.
  useEffect(() => {
    if (!address.area.trim() || branchAutoSuggested) return;
    const match = branches.find((b) => branchMatchesArea(b, address.area));
    if (match) {
      setBranchId(match.id);
      setBranchAutoSuggested(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.area, branches]);

  async function searchCustomer() {
    if (!phone.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await callFunction<{
        found: boolean;
        name?: string;
        address?: Address | null;
      }>("lookup-customer", { phone: phone.trim() });
      setCustomerFound(res.found);
      if (res.found) {
        setName(res.name ?? "");
        setAddress({
          building: res.address?.building ?? "",
          floor: res.address?.floor ?? "",
          apartment: res.address?.apartment ?? "",
          area: res.address?.area ?? "",
        });
      } else {
        setName("");
        setAddress(emptyAddress);
      }
      setBranchAutoSuggested(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل البحث عن العميل");
    } finally {
      setSearching(false);
    }
  }

  function addToCart(line: Omit<CartLine, "quantity">) {
    setCart((prev) => {
      const existing = prev.find((l) => l.key === line.key);
      if (existing) {
        return prev.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { ...line, quantity: 1 }];
    });
  }

  function changeQuantity(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function setLineNote(key: string, note: string) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, note } : l)));
  }

  const cartTotal = useMemo(
    () => cart.reduce((sum, l) => sum + l.unit_price * l.quantity, 0),
    [cart],
  );

  const itemsByCategory = useMemo(() => {
    const map = new Map<number, MenuItem[]>();
    for (const item of menuItems) {
      const list = map.get(item.category_id) ?? [];
      list.push(item);
      map.set(item.category_id, list);
    }
    return map;
  }, [menuItems]);

  const choiceGroupsByCombo = useMemo(() => {
    const map = new Map<number, ComboChoiceGroup[]>();
    for (const group of comboChoiceGroups) {
      const list = map.get(group.combo_offer_id) ?? [];
      list.push(group);
      map.set(group.combo_offer_id, list);
    }
    return map;
  }, [comboChoiceGroups]);

  function selectComboOption(comboId: number, groupId: number, optionId: number) {
    setComboSelections((prev) => ({ ...prev, [comboId]: { ...prev[comboId], [groupId]: optionId } }));
  }

  function addComboToCart(combo: ComboOffer) {
    const groups = choiceGroupsByCombo.get(combo.id) ?? [];
    const selection = comboSelections[combo.id] ?? {};
    const missing = groups.some((g) => !selection[g.id]);
    if (missing) {
      setError("اختار كل خيارات العرض الأول");
      return;
    }
    setError(null);
    const optionIds = groups.map((g) => selection[g.id]);
    const labels = groups.map((g) => g.combo_choice_options.find((o) => o.id === selection[g.id])?.label ?? "");
    const key = optionIds.length > 0 ? `combo-${combo.id}-${optionIds.join("-")}` : `combo-${combo.id}`;
    addToCart({
      key,
      combo_offer_id: combo.id,
      name: combo.name,
      unit_price: combo.price,
      comboChoiceOptionIds: optionIds.length > 0 ? optionIds : undefined,
      comboChoiceLabels: labels.length > 0 ? labels : undefined,
    });
  }

  function resetForm() {
    setPhone("");
    setCustomerFound(null);
    setName("");
    setAddress(emptyAddress);
    setBranchId("");
    setBranchAutoSuggested(false);
    setCart([]);
    setPaymentMethod("cash");
    setProofFile(null);
  }

  async function submitOrder() {
    setError(null);
    if (!phone.trim()) return setError("لازم رقم تليفون العميل");
    if (!branchId) return setError("لازم تختار الفرع");
    if (cart.length === 0) return setError("السلة فاضية - ضيف صنف على الأقل");
    if (paymentMethod === "instapay_transfer" && !proofFile) {
      return setError("لازم صورة إثبات التحويل لو الدفع انستاباي");
    }

    setSubmitting(true);
    try {
      let paymentProofUrl: string | undefined;
      if (paymentMethod === "instapay_transfer" && proofFile) {
        const path = `guest/${phone.trim()}-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("payment-proofs")
          .upload(path, proofFile, { contentType: proofFile.type || "image/jpeg" });
        if (uploadError) throw new Error(`فشل رفع إثبات الدفع: ${uploadError.message}`);
        paymentProofUrl = path;
      }

      const res = await callFunction<{ order_id: number }>("create-order", {
        customer_phone: phone.trim(),
        customer_name: name.trim() || undefined,
        address: {
          building: address.building || undefined,
          floor: address.floor || undefined,
          apartment: address.apartment || undefined,
          area: address.area || undefined,
        },
        branch_id: branchId,
        items: cart.map((l) => ({
          menu_item_id: l.menu_item_id,
          combo_offer_id: l.combo_offer_id,
          quantity: l.quantity,
          combo_choice_option_ids: l.comboChoiceOptionIds,
          note: l.note,
        })),
        payment_method: paymentMethod,
        payment_proof_url: paymentProofUrl,
      });

      setSuccessOrderId(res.order_id);
      resetForm();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message.includes("outside business hours")
          ? "الموقع برا مواعيد استقبال الأوردرات دلوقتي - راجع مواعيد العمل"
          : message || "فشل إنشاء الأوردر",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {successOrderId != null && (
        <div className="card success-banner">
          <p>تم إنشاء الأوردر #{successOrderId} بنجاح - بانتظار القبول من التيم ليدر.</p>
        </div>
      )}

      <div className="card">
        <h2>بيانات العميل</h2>
        <div className="inline-row">
          <input
            type="tel"
            inputMode="numeric"
            placeholder="رقم تليفون العميل"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button className="btn-primary" onClick={searchCustomer} disabled={searching}>
            {searching ? "جاري البحث..." : "بحث"}
          </button>
        </div>
        {customerFound === true && <p className="muted">عميل موجود - البيانات اتملت تلقائيًا.</p>}
        {customerFound === false && <p className="muted">عميل جديد - اكتب بياناته.</p>}

        <label>
          الاسم
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid-2">
          <label>
            عمارة
            <input value={address.building} onChange={(e) => setAddress({ ...address, building: e.target.value })} />
          </label>
          <label>
            دور
            <input value={address.floor} onChange={(e) => setAddress({ ...address, floor: e.target.value })} />
          </label>
          <label>
            شقة
            <input value={address.apartment} onChange={(e) => setAddress({ ...address, apartment: e.target.value })} />
          </label>
          <label>
            المنطقة
            <input value={address.area} onChange={(e) => setAddress({ ...address, area: e.target.value })} />
          </label>
        </div>

        <label>
          الفرع
          <select value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">-- اختر الفرع --</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <h2>المنيو</h2>
        {categories.map((cat) => {
          const items = itemsByCategory.get(cat.id) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={cat.id} className="menu-category">
              <h3>{cat.name}</h3>
              <div className="menu-grid">
                {items.map((item) => (
                  <button
                    key={item.id}
                    className="menu-item-btn"
                    onClick={() =>
                      addToCart({
                        key: `item-${item.id}`,
                        menu_item_id: item.id,
                        name: item.name,
                        unit_price: item.price,
                      })
                    }
                  >
                    <span>{item.name}</span>
                    <span className="muted">{item.price} ج</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {combos.length > 0 && (
          <div className="menu-category">
            <h3>الكومبوهات</h3>
            <div className="menu-grid">
              {combos.map((combo) => {
                const groups = choiceGroupsByCombo.get(combo.id) ?? [];
                const selection = comboSelections[combo.id] ?? {};
                return (
                  <div key={combo.id} className="pending-order-card card">
                    <div className="pending-order-header">
                      <strong>{combo.name}</strong>
                      <span className="muted">{combo.price} ج</span>
                    </div>
                    {groups.map((group) => (
                      <div key={group.id} style={{ marginTop: 6 }}>
                        <p className="muted" style={{ fontSize: "0.85rem", fontWeight: 700 }}>{group.label}</p>
                        {group.combo_choice_options.map((option) => (
                          <label key={option.id} className="radio-label" style={{ display: "block", fontSize: "0.85rem" }}>
                            <input
                              type="radio"
                              name={`cc-combo-${combo.id}-group-${group.id}`}
                              checked={selection[group.id] === option.id}
                              onChange={() => selectComboOption(combo.id, group.id, option.id)}
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    ))}
                    <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => addComboToCart(combo)}>
                      ضيف للسلة
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>السلة ({cart.length})</h2>
        {cart.length === 0 && <p className="muted">مفيش أصناف لسه</p>}
        {cart.map((line) => (
          <div key={line.key} className="cart-line-wrap">
            <div className="cart-line">
              <span>
                {line.name}
                {line.comboChoiceLabels && line.comboChoiceLabels.length > 0 && (
                  <span className="muted" style={{ display: "block", fontSize: "0.8rem" }}>
                    {line.comboChoiceLabels.join(" - ")}
                  </span>
                )}
              </span>
              <span className="cart-qty">
                <button onClick={() => changeQuantity(line.key, -1)}>-</button>
                {line.quantity}
                <button onClick={() => changeQuantity(line.key, 1)}>+</button>
              </span>
              <span>{line.unit_price * line.quantity} ج</span>
            </div>
            <input
              className="cart-line-note"
              placeholder="ملاحظة على الصنف ده (اختياري)"
              value={line.note ?? ""}
              onChange={(e) => setLineNote(line.key, e.target.value)}
            />
          </div>
        ))}
        {cart.length > 0 && <p className="cart-total">الإجمالي: {cartTotal} ج</p>}
      </div>

      <div className="card">
        <h2>الدفع</h2>
        <label className="radio-label">
          <input
            type="radio"
            checked={paymentMethod === "cash"}
            onChange={() => setPaymentMethod("cash")}
          />
          كاش عند الاستلام
        </label>
        <label className="radio-label">
          <input
            type="radio"
            checked={paymentMethod === "instapay_transfer"}
            onChange={() => setPaymentMethod("instapay_transfer")}
          />
          تحويل انستاباي
        </label>
        {paymentMethod === "instapay_transfer" && (
          <label>
            صورة إثبات التحويل
            <input type="file" accept="image/*" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      <button className="btn-primary btn-large" disabled={submitting} onClick={submitOrder}>
        {submitting ? "جاري الإنشاء..." : "تأكيد الطلب"}
      </button>
    </div>
  );
}
