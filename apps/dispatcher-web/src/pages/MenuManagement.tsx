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
}

export function MenuManagement() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<number, string>>({});
  const [savingDescriptionId, setSavingDescriptionId] = useState<number | null>(null);

  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategoryId, setNewCategoryId] = useState<number | "">("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const [categoriesRes, itemsRes] = await Promise.all([
      supabase.from("menu_categories").select("id, name, display_order").order("display_order"),
      supabase.from("menu_items").select("id, category_id, name, price, is_available, image_url, description").order("id"),
    ]);
    const loadedCategories = (categoriesRes.data as MenuCategory[]) ?? [];
    const loadedItems = (itemsRes.data as MenuItem[]) ?? [];
    setCategories(loadedCategories);
    setItems(loadedItems);
    setDescriptionDrafts(Object.fromEntries(loadedItems.map((i) => [i.id, i.description ?? ""])));
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

  async function handleUpload(item: MenuItem, file: File) {
    setError(null);
    setUploadingId(item.id);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${item.id}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("menu-images").upload(path, file, {
        upsert: true,
        cacheControl: "3600",
      });
      if (uploadError) throw new Error(uploadError.message);
      const { data: publicUrlData } = supabase.storage.from("menu-images").getPublicUrl(path);
      // cache-bust so the new photo shows immediately instead of the
      // previous upload's cached response at the same path
      const url = `${publicUrlData.publicUrl}?t=${Date.now()}`;
      const { error: updateError } = await supabase.from("menu_items").update({ image_url: url }).eq("id", item.id);
      if (updateError) throw new Error(updateError.message);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, image_url: url } : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل رفع الصورة");
    } finally {
      setUploadingId(null);
    }
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
    const { error: insertError } = await supabase.from("menu_items").insert({
      category_id: newCategoryId,
      name: newName.trim(),
      price,
      description: newDescription.trim() || null,
      is_available: true,
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

      {categories.map((category) => {
        const categoryItems = itemsByCategory.get(category.id) ?? [];
        if (categoryItems.length === 0) return null;
        return (
          <div key={category.id} className="card">
            <h2>{category.name}</h2>
            <div className="order-list">
              {categoryItems.map((item) => (
                <div key={item.id} className="pending-order-card card">
                  <div className="pending-order-header">
                    <strong>{item.name}</strong>
                    <span className="muted">{item.price} ج{!item.is_available && " - مخفي من المنيو"}</span>
                  </div>
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
    </div>
  );
}
