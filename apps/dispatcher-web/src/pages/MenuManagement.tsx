import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

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
  image_url: string | null;
  description: string | null;
  display_order: number;
}

interface ComboOffer {
  id: number;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
}

interface ComboChoiceOption {
  id: number;
  choice_group_id: number;
  label: string;
  is_available: boolean;
}

interface ComboChoiceGroup {
  id: number;
  combo_offer_id: number;
  label: string;
  combo_choice_options: ComboChoiceOption[];
}

export function MenuManagement() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [combos, setCombos] = useState<ComboOffer[]>([]);
  const [comboChoiceGroups, setComboChoiceGroups] = useState<ComboChoiceGroup[]>([]);
  const [togglingOptionId, setTogglingOptionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [movingCategoryId, setMovingCategoryId] = useState<number | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);

  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<number, string>>({});
  const [savingDescriptionId, setSavingDescriptionId] = useState<number | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({});
  const [savingPriceId, setSavingPriceId] = useState<number | null>(null);
  const [comboPriceDrafts, setComboPriceDrafts] = useState<Record<number, string>>({});
  const [savingComboPriceId, setSavingComboPriceId] = useState<number | null>(null);
  const [deletingComboId, setDeletingComboId] = useState<number | null>(null);
  const [togglingComboId, setTogglingComboId] = useState<number | null>(null);
  const [comboSectionLabel, setComboSectionLabel] = useState("الكومبوهات");
  const [comboSectionLabelDraft, setComboSectionLabelDraft] = useState("الكومبوهات");
  const [savingComboSectionLabel, setSavingComboSectionLabel] = useState(false);

  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategoryId, setNewCategoryId] = useState<number | "">("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [newComboOpen, setNewComboOpen] = useState(false);
  const [newComboName, setNewComboName] = useState("");
  const [newComboDescription, setNewComboDescription] = useState("");
  const [newComboPrice, setNewComboPrice] = useState("");
  const [creatingCombo, setCreatingCombo] = useState(false);

  async function load() {
    const [categoriesRes, itemsRes, combosRes, comboSectionRes, choiceGroupsRes] = await Promise.all([
      supabase.from("menu_categories").select("id, name, display_order").order("display_order"),
      supabase
        .from("menu_items")
        .select("id, category_id, name, price, is_available, image_url, description, display_order")
        .order("display_order")
        .order("id"),
      supabase.from("combo_offers").select("id, name, description, price, is_active").order("id"),
      supabase.from("combo_section_settings").select("label").eq("id", 1).maybeSingle(),
      supabase
        .from("combo_choice_groups")
        .select("id, combo_offer_id, label, combo_choice_options(id, choice_group_id, label, is_available, display_order)")
        .order("display_order"),
    ]);
    const loadedCategories = (categoriesRes.data as MenuCategory[]) ?? [];
    const loadedItems = (itemsRes.data as MenuItem[]) ?? [];
    const loadedCombos = (combosRes.data as ComboOffer[]) ?? [];
    setCategories(loadedCategories);
    setItems(loadedItems);
    setCombos(loadedCombos);
    setComboChoiceGroups((choiceGroupsRes.data as ComboChoiceGroup[]) ?? []);
    setDescriptionDrafts(Object.fromEntries(loadedItems.map((i) => [i.id, i.description ?? ""])));
    setPriceDrafts(Object.fromEntries(loadedItems.map((i) => [i.id, String(i.price)])));
    setComboPriceDrafts(Object.fromEntries(loadedCombos.map((c) => [c.id, String(c.price)])));
    const label = comboSectionRes.data?.label ?? "الكومبوهات";
    setComboSectionLabel(label);
    setComboSectionLabelDraft(label);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const itemsByCategory = useMemo(() => {
    const map = new Map<number, MenuItem[]>();
    for (const item of items) {
      const list = map.get(item.category_id) ?? [];
      list.push(item);
      map.set(item.category_id, list);
    }
    return map;
  }, [items]);

  const choiceGroupsByCombo = useMemo(() => {
    const map = new Map<number, ComboChoiceGroup[]>();
    for (const group of comboChoiceGroups) {
      const list = map.get(group.combo_offer_id) ?? [];
      list.push(group);
      map.set(group.combo_offer_id, list);
    }
    return map;
  }, [comboChoiceGroups]);

  async function toggleChoiceOptionAvailable(option: ComboChoiceOption) {
    setError(null);
    setTogglingOptionId(option.id);
    const { error: updateError } = await supabase
      .from("combo_choice_options")
      .update({ is_available: !option.is_available })
      .eq("id", option.id);
    setTogglingOptionId(null);
    if (updateError) return setError(updateError.message);
    setComboChoiceGroups((prev) =>
      prev.map((g) => ({
        ...g,
        combo_choice_options: g.combo_choice_options.map((o) =>
          o.id === option.id ? { ...o, is_available: !o.is_available } : o,
        ),
      })),
    );
  }

  async function handleUpload(item: MenuItem, file: File) {
    setError(null);
    setUploadingId(item.id);
    try {
      // Uploaded server-side (upload-image edge function) - the server
      // checks the actual file bytes against real image signatures rather
      // than trusting this File object's declared/guessed type, see the
      // function's own comment for why that distinction matters.
      const formData = new FormData();
      formData.append("bucket", "menu-images");
      formData.append("entity_id", String(item.id));
      formData.append("file", file);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const { data, error: uploadError } = await supabase.functions.invoke<{ url: string }>("upload-image", {
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (uploadError) throw new Error(uploadError.message);
      const url = data!.url;
      const { error: updateError } = await supabase.from("menu_items").update({ image_url: url }).eq("id", item.id);
      if (updateError) throw new Error(updateError.message);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, image_url: url } : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل رفع الصورة");
    } finally {
      setUploadingId(null);
    }
  }

  async function deleteItem(item: MenuItem) {
    if (!confirm(`حذف "${item.name}" نهائيًا؟ الخطوة دي مش قابلة للتراجع.`)) return;
    setError(null);
    setDeletingId(item.id);
    const { error: deleteError } = await supabase.from("menu_items").delete().eq("id", item.id);
    setDeletingId(null);
    if (deleteError) {
      // 23503 = Postgres foreign-key violation - this item was actually
      // ordered before, so order_items still points at it and the delete
      // is correctly refused rather than silently orphaning real order
      // history.
      if (deleteError.code === "23503") {
        setError(`"${item.name}" اتطلب قبل كده في أوردرات حقيقية - مينفعش يتمسح نهائي، تقدر تخليه غير متاح بدل ما تمسحه`);
      } else {
        setError(deleteError.message);
      }
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  // Swaps display_order with the adjacent item in the same category -
  // simple, reliable, and easy to verify (no drag-and-drop library, no
  // renumbering the whole category on every move).
  async function moveItem(item: MenuItem, direction: "up" | "down") {
    setError(null);
    const categoryItems = itemsByCategory.get(item.category_id) ?? [];
    const idx = categoryItems.findIndex((i) => i.id === item.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= categoryItems.length) return;
    const other = categoryItems[swapIdx];

    setMovingId(item.id);
    const [a, b] = await Promise.all([
      supabase.from("menu_items").update({ display_order: other.display_order }).eq("id", item.id),
      supabase.from("menu_items").update({ display_order: item.display_order }).eq("id", other.id),
    ]);
    setMovingId(null);
    if (a.error) return setError(a.error.message);
    if (b.error) return setError(b.error.message);
    load();
  }

  // Swaps display_order with the adjacent category - same pattern as
  // moveItem, one level up. categories is already sorted by display_order
  // (the load() query), so adjacent-in-array really does mean adjacent-
  // in-display.
  async function moveCategory(category: MenuCategory, direction: "up" | "down") {
    setError(null);
    const idx = categories.findIndex((c) => c.id === category.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= categories.length) return;
    const other = categories[swapIdx];

    setMovingCategoryId(category.id);
    const [a, b] = await Promise.all([
      supabase.from("menu_categories").update({ display_order: other.display_order }).eq("id", category.id),
      supabase.from("menu_categories").update({ display_order: category.display_order }).eq("id", other.id),
    ]);
    setMovingCategoryId(null);
    if (a.error) return setError(a.error.message);
    if (b.error) return setError(b.error.message);
    load();
  }

  async function deleteCategory(category: MenuCategory) {
    const categoryItems = itemsByCategory.get(category.id) ?? [];
    if (categoryItems.length > 0) {
      return setError(`لسه فيه ${categoryItems.length} صنف في "${category.name}" - امسحهم الأول قبل ما تمسح القسم`);
    }
    if (!confirm(`حذف قسم "${category.name}" نهائيًا؟`)) return;
    setError(null);
    setDeletingCategoryId(category.id);
    const { error: deleteError } = await supabase.from("menu_categories").delete().eq("id", category.id);
    setDeletingCategoryId(null);
    if (deleteError) return setError(deleteError.message);
    setCategories((prev) => prev.filter((c) => c.id !== category.id));
  }

  async function savePrice(item: MenuItem) {
    setError(null);
    const value = Number(priceDrafts[item.id]);
    if (Number.isNaN(value) || value <= 0) return setError("السعر لازم يكون رقم صحيح أكبر من صفر");
    setSavingPriceId(item.id);
    const { error: updateError } = await supabase.from("menu_items").update({ price: value }).eq("id", item.id);
    setSavingPriceId(null);
    if (updateError) return setError(updateError.message);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, price: value } : i)));
  }

  async function saveComboPrice(combo: ComboOffer) {
    setError(null);
    const value = Number(comboPriceDrafts[combo.id]);
    if (Number.isNaN(value) || value <= 0) return setError("سعر الكومبو لازم يكون رقم صحيح أكبر من صفر");
    setSavingComboPriceId(combo.id);
    const { error: updateError } = await supabase.from("combo_offers").update({ price: value }).eq("id", combo.id);
    setSavingComboPriceId(null);
    if (updateError) return setError(updateError.message);
    setCombos((prev) => prev.map((c) => (c.id === combo.id ? { ...c, price: value } : c)));
  }

  async function saveComboSectionLabel() {
    setError(null);
    const trimmed = comboSectionLabelDraft.trim();
    if (!trimmed) return setError("اسم القسم مينفعش يبقى فاضي");
    setSavingComboSectionLabel(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { error: updateError } = await supabase
      .from("combo_section_settings")
      .update({ label: trimmed, updated_by: sessionData.session?.user.id ?? null })
      .eq("id", 1);
    setSavingComboSectionLabel(false);
    if (updateError) return setError(updateError.message);
    setComboSectionLabel(trimmed);
    setComboSectionLabelDraft(trimmed);
  }

  // Permanent close (is_active=false) - different from both hard delete
  // (irreversible, wipes the row) and the per-branch closures in
  // MenuAvailability.tsx (temporary, branch-scoped). This is "off
  // everywhere, for good, until someone flips it back on" - Karim's own
  // distinction: he wants to be able to shut a combo down without losing
  // it the way delete would. combos_select_public's RLS already only
  // shows is_active=true rows to customers/call_center, so this alone is
  // enough to pull it off every customer-facing and phone-order screen.
  async function toggleComboActive(combo: ComboOffer) {
    setError(null);
    setTogglingComboId(combo.id);
    const { error: updateError } = await supabase
      .from("combo_offers")
      .update({ is_active: !combo.is_active })
      .eq("id", combo.id);
    setTogglingComboId(null);
    if (updateError) return setError(updateError.message);
    setCombos((prev) => prev.map((c) => (c.id === combo.id ? { ...c, is_active: !c.is_active } : c)));
  }

  async function deleteCombo(combo: ComboOffer) {
    if (!confirm(`حذف "${combo.name}" نهائيًا؟ الخطوة دي مش قابلة للتراجع - استخدمها لما العرض يخلص.`)) return;
    setError(null);
    setDeletingComboId(combo.id);
    const { error: deleteError } = await supabase.from("combo_offers").delete().eq("id", combo.id);
    setDeletingComboId(null);
    if (deleteError) {
      // Same "protect real order history" pattern as deleteItem - a combo
      // that was actually ordered before can't be hard-deleted.
      if (deleteError.code === "23503") {
        setError(`"${combo.name}" اتطلب قبل كده في أوردرات حقيقية - مينفعش يتمسح نهائي`);
      } else {
        setError(deleteError.message);
      }
      return;
    }
    setCombos((prev) => prev.filter((c) => c.id !== combo.id));
  }

  async function removePhoto(item: MenuItem) {
    setError(null);
    const { error: updateError } = await supabase.from("menu_items").update({ image_url: null }).eq("id", item.id);
    if (updateError) return setError(updateError.message);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, image_url: null } : i)));
  }

  async function saveDescription(item: MenuItem) {
    setError(null);
    setSavingDescriptionId(item.id);
    const text = descriptionDrafts[item.id]?.trim() || null;
    const { error: updateError } = await supabase.from("menu_items").update({ description: text }).eq("id", item.id);
    setSavingDescriptionId(null);
    if (updateError) return setError(updateError.message);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, description: text } : i)));
  }

  async function handleCreateItem(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return setError("اسم المنتج مطلوب");
    if (!newCategoryId) return setError("اختار قسم المنتج");
    const price = Number(newPrice);
    if (!newPrice || Number.isNaN(price) || price <= 0) return setError("السعر لازم يكون رقم صحيح أكبر من صفر");

    setCreating(true);
    // New items land at the end of their category's order, not display_
    // order's column default (0), which would otherwise jump them to the
    // very top unexpectedly.
    const categoryItems = itemsByCategory.get(newCategoryId) ?? [];
    const nextOrder = categoryItems.length > 0 ? Math.max(...categoryItems.map((i) => i.display_order)) + 1 : 1;
    const { error: insertError } = await supabase.from("menu_items").insert({
      category_id: newCategoryId,
      name: newName.trim(),
      price,
      description: newDescription.trim() || null,
      is_available: true,
      display_order: nextOrder,
    });
    setCreating(false);
    if (insertError) return setError(insertError.message);

    setNewName("");
    setNewPrice("");
    setNewCategoryId("");
    setNewDescription("");
    setNewItemOpen(false);
    load();
  }

  // A combo created here has no choice_groups rows (those are added
  // separately, there's no UI for that yet) - create-order already treats
  // zero choice groups as valid (only validates "exactly one option per
  // group" when groups.length > 0), so a plain combo with just a
  // name/description/price works correctly end to end, same as the
  // existing 3 combo offers did before this screen could edit them at all.
  async function handleCreateCombo(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newComboName.trim()) return setError("اسم العرض مطلوب");
    const price = Number(newComboPrice);
    if (!newComboPrice || Number.isNaN(price) || price <= 0) return setError("سعر العرض لازم يكون رقم صحيح أكبر من صفر");

    setCreatingCombo(true);
    const { error: insertError } = await supabase.from("combo_offers").insert({
      name: newComboName.trim(),
      description: newComboDescription.trim() || null,
      price,
      is_active: true,
    });
    setCreatingCombo(false);
    if (insertError) return setError(insertError.message);

    setNewComboName("");
    setNewComboDescription("");
    setNewComboPrice("");
    setNewComboOpen(false);
    load();
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      <h2>المنتجات</h2>
      {error && <p className="error-text">{error}</p>}

      <div className="card">
        {!newItemOpen ? (
          <button className="btn-primary" onClick={() => setNewItemOpen(true)}>
            + إضافة منتج جديد
          </button>
        ) : (
          <form onSubmit={handleCreateItem}>
            <h2>منتج جديد</h2>
            <div className="inline-row">
              <input placeholder="اسم المنتج" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <select value={newCategoryId} onChange={(e) => setNewCategoryId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">-- اختار القسم --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="السعر"
                type="number"
                min="0"
                step="0.01"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
            </div>
            <textarea
              placeholder="شرح المنتج (اختياري)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              style={{ width: "100%", marginTop: "8px" }}
            />
            <div className="inline-row" style={{ marginTop: "8px" }}>
              <button className="btn-primary" type="submit" disabled={creating}>
                {creating ? "جاري الإضافة..." : "إضافة"}
              </button>
              <button type="button" className="btn-link" onClick={() => setNewItemOpen(false)}>
                إلغاء
              </button>
            </div>
          </form>
        )}
      </div>

      {categories.map((category, catIdx) => {
        const categoryItems = itemsByCategory.get(category.id) ?? [];
        return (
          <div key={category.id} className="card">
            <div className="reorder-controls">
              <button
                className="btn-sm btn-link"
                disabled={movingCategoryId !== null || catIdx === 0}
                onClick={() => moveCategory(category, "up")}
                title="حرّك القسم لفوق"
              >
                ▲
              </button>
              <button
                className="btn-sm btn-link"
                disabled={movingCategoryId !== null || catIdx === categories.length - 1}
                onClick={() => moveCategory(category, "down")}
                title="حرّك القسم لتحت"
              >
                ▼
              </button>
              <span className="muted reorder-controls-hint">ترتيب القسم</span>
            </div>
            <div className="pending-order-header">
              <h2 style={{ margin: 0 }}>{category.name}</h2>
              <button
                className="btn-danger btn-sm"
                disabled={deletingCategoryId === category.id}
                onClick={() => deleteCategory(category)}
              >
                {deletingCategoryId === category.id ? "جاري الحذف..." : "حذف القسم"}
              </button>
            </div>
            {categoryItems.length === 0 && <p className="muted">مفيش أصناف في القسم ده.</p>}
            <div className="order-list">
              {categoryItems.map((item, idx) => (
                <div key={item.id} className="pending-order-card card">
                  <div className="reorder-controls">
                    <button
                      className="btn-sm btn-link"
                      disabled={movingId !== null || idx === 0}
                      onClick={() => moveItem(item, "up")}
                      title="حرّك لفوق"
                    >
                      ▲
                    </button>
                    <button
                      className="btn-sm btn-link"
                      disabled={movingId !== null || idx === categoryItems.length - 1}
                      onClick={() => moveItem(item, "down")}
                      title="حرّك لتحت"
                    >
                      ▼
                    </button>
                    <span className="muted reorder-controls-hint">ترتيب الظهور</span>
                  </div>
                  <div className="pending-order-header">
                    <strong>{item.name}</strong>
                    {!item.is_available && <span className="muted">مخفي من المنيو</span>}
                  </div>
                  <div className="actions-cell">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      style={{ width: "80px" }}
                      value={priceDrafts[item.id] ?? ""}
                      onChange={(e) => setPriceDrafts({ ...priceDrafts, [item.id]: e.target.value })}
                    />
                    <span className="muted">ج</span>
                    <button
                      className="btn-sm btn-primary"
                      disabled={savingPriceId === item.id || priceDrafts[item.id] === String(item.price)}
                      onClick={() => savePrice(item)}
                    >
                      {savingPriceId === item.id ? "جاري الحفظ..." : "حفظ السعر"}
                    </button>
                  </div>
                  <button
                    className="btn-danger btn-sm"
                    style={{ alignSelf: "flex-start" }}
                    disabled={deletingId === item.id}
                    onClick={() => deleteItem(item)}
                  >
                    {deletingId === item.id ? "جاري الحذف..." : "حذف نهائي"}
                  </button>
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      style={{ width: "160px", height: "120px", objectFit: "cover", borderRadius: "8px" }}
                    />
                  ) : (
                    <p className="muted">مفيش صورة لسه</p>
                  )}
                  <div className="inline-row">
                    <label className="btn-primary" style={{ cursor: "pointer" }}>
                      {uploadingId === item.id ? "جاري الرفع..." : item.image_url ? "تغيير الصورة" : "رفع صورة"}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        disabled={uploadingId === item.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(item, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {item.image_url && (
                      <button className="btn-link" onClick={() => removePhoto(item)}>
                        حذف الصورة
                      </button>
                    )}
                  </div>
                  <textarea
                    placeholder="اكتب شرح المنتج هنا..."
                    value={descriptionDrafts[item.id] ?? ""}
                    onChange={(e) => setDescriptionDrafts({ ...descriptionDrafts, [item.id]: e.target.value })}
                    rows={2}
                    style={{ width: "100%", marginTop: "8px" }}
                  />
                  <button
                    className="btn-link"
                    disabled={savingDescriptionId === item.id || (descriptionDrafts[item.id] ?? "") === (item.description ?? "")}
                    onClick={() => saveDescription(item)}
                  >
                    {savingDescriptionId === item.id ? "جاري الحفظ..." : "حفظ الشرح"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="card">
        <h2>{comboSectionLabel}</h2>
        <div className="actions-cell" style={{ marginTop: "-4px", marginBottom: "8px" }}>
          <input
            placeholder="اسم القسم"
            style={{ width: "180px" }}
            value={comboSectionLabelDraft}
            onChange={(e) => setComboSectionLabelDraft(e.target.value)}
          />
          <button
            className="btn-sm btn-primary"
            disabled={savingComboSectionLabel || comboSectionLabelDraft.trim() === comboSectionLabel}
            onClick={saveComboSectionLabel}
          >
            {savingComboSectionLabel ? "جاري الحفظ..." : "حفظ اسم القسم"}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          "إيقاف نهائي" بيخفي الكومبو من كل مكان (المنيو والكول سنتر) من غير ما يتمسح - تقدر ترجّعه تاني وقت ما
          عايز. "حذف نهائي" مختلف: مفيش رجوع منه، استخدمه بس لما تتأكد إنك مش هتحتاج الكومبو ده تاني. الإقفال
          المؤقت حسب فرع معين لوحده موجود في شاشة "إقفال الأصناف".
        </p>

        {!newComboOpen ? (
          <button className="btn-primary" onClick={() => setNewComboOpen(true)}>
            + إضافة عرض جديد
          </button>
        ) : (
          <form onSubmit={handleCreateCombo} style={{ marginBottom: "var(--space-3)" }}>
            <h3 style={{ marginBottom: 8 }}>عرض جديد</h3>
            <div className="inline-row">
              <input placeholder="اسم العرض" value={newComboName} onChange={(e) => setNewComboName(e.target.value)} />
              <input
                placeholder="السعر"
                type="number"
                min="0"
                step="0.01"
                value={newComboPrice}
                onChange={(e) => setNewComboPrice(e.target.value)}
              />
            </div>
            <textarea
              placeholder="شرح العرض (اختياري)"
              value={newComboDescription}
              onChange={(e) => setNewComboDescription(e.target.value)}
              rows={2}
              style={{ width: "100%", marginTop: "8px" }}
            />
            <div className="inline-row" style={{ marginTop: "8px" }}>
              <button className="btn-primary" type="submit" disabled={creatingCombo}>
                {creatingCombo ? "جاري الإضافة..." : "إضافة"}
              </button>
              <button type="button" className="btn-link" onClick={() => setNewComboOpen(false)}>
                إلغاء
              </button>
            </div>
          </form>
        )}

        {combos.length === 0 && <p className="muted">مفيش كومبوهات دلوقتي.</p>}
        {combos.length > 0 && (
          <div className="order-list">
            {combos.map((combo) => (
              <div key={combo.id} className="pending-order-card card">
                <div className="pending-order-header">
                  <strong>{combo.name}</strong>
                  {!combo.is_active && <span className="muted">غير نشط</span>}
                </div>
                <div className="actions-cell">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    style={{ width: "80px" }}
                    value={comboPriceDrafts[combo.id] ?? ""}
                    onChange={(e) => setComboPriceDrafts({ ...comboPriceDrafts, [combo.id]: e.target.value })}
                  />
                  <span className="muted">ج</span>
                  <button
                    className="btn-sm btn-primary"
                    disabled={savingComboPriceId === combo.id || comboPriceDrafts[combo.id] === String(combo.price)}
                    onClick={() => saveComboPrice(combo)}
                  >
                    {savingComboPriceId === combo.id ? "جاري الحفظ..." : "حفظ السعر"}
                  </button>
                </div>
                {(choiceGroupsByCombo.get(combo.id) ?? []).map((group) => (
                  <div key={group.id} style={{ marginTop: 8 }}>
                    <p className="muted" style={{ margin: "0 0 4px" }}>{group.label}</p>
                    <div className="status-pill-row">
                      {group.combo_choice_options.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`status-pill${option.is_available ? "" : " status-pill-danger"}`}
                          disabled={togglingOptionId === option.id}
                          title={option.is_available ? "اضغط لإيقافه" : "اضغط لتفعيله تاني"}
                          onClick={() => toggleChoiceOptionAvailable(option)}
                        >
                          {option.label}
                          {!option.is_available && " (موقوف)"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="actions-cell">
                  <button
                    className="btn-sm btn-primary"
                    disabled={togglingComboId === combo.id}
                    onClick={() => toggleComboActive(combo)}
                  >
                    {togglingComboId === combo.id ? "جاري التحديث..." : combo.is_active ? "إيقاف نهائي" : "تفعيل تاني"}
                  </button>
                </div>
                <button
                  className="btn-danger btn-sm"
                  style={{ alignSelf: "flex-start" }}
                  disabled={deletingComboId === combo.id}
                  onClick={() => deleteCombo(combo)}
                >
                  {deletingComboId === combo.id ? "جاري الحذف..." : "حذف نهائي (لما العرض يخلص)"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
