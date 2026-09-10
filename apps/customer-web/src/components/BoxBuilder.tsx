import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useCart } from "../lib/CartContext";

// "اصنع وجبتك بنفسك" (Karim, 2026-09-10) - the new homepage centerpiece.
// Flow, confirmed with Karim across three rounds of questions: pick a
// buildable category (كشري/طاجن) -> pick a box size (fixed price + a gram
// budget) -> fill the box freely from real menu_items up to that budget at
// no extra charge -> category-specific paid extras -> a final مقبلات
// upsell. create-order re-validates every gram/price server-side (see
// supabase/functions/create-order/index.ts) - nothing computed here is
// trusted as-is, this is purely the shopping experience.

interface BoxCategory {
  id: number;
  name: string;
}
interface BoxSizeRow {
  id: number;
  category_id: number;
  name: string;
  price: number;
  capacity_grams: number;
  is_available: boolean;
}
interface FillComponentRow {
  id: number;
  category_id: number;
  menu_item_id: number;
  grams_per_unit: number;
  is_available: boolean;
}
interface ExtraSuggestionRow {
  id: number;
  category_id: number;
  menu_item_id: number;
  is_available: boolean;
}
interface MenuItemLite {
  id: number;
  category_id: number;
  name: string;
  price: number;
  image_url: string | null;
}

// Cycled per fill component so the box visual reads as distinct layers,
// not one undifferentiated blob - order matches roughly how a real koshary
// box gets built (base grains first, sauces/toppings last).
const LAYER_COLORS = [
  "var(--color-onion)",
  "var(--color-tomato)",
  "var(--color-parsley)",
  "var(--color-cup)",
  "var(--color-lentil-muted)",
  "var(--color-tomato-dark)",
  "var(--color-onion-dark)",
];

// No dedicated "مقبلات" category exists today - "اضافات" (extras/add-ons)
// is the closest match in the current menu. My call, easy to point at a
// different category name later if Karim wants a distinct one.
const UPSELL_CATEGORY_NAME = "اضافات";

type Step = "type" | "size" | "fill" | "extras" | "upsell";

export function BoxBuilder() {
  const cart = useCart();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<BoxCategory[]>([]);
  const [boxSizes, setBoxSizes] = useState<BoxSizeRow[]>([]);
  const [fillComponents, setFillComponents] = useState<FillComponentRow[]>([]);
  const [extraSuggestions, setExtraSuggestions] = useState<ExtraSuggestionRow[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemLite[]>([]);
  const [upsellCategoryId, setUpsellCategoryId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("type");
  const [selectedCategory, setSelectedCategory] = useState<BoxCategory | null>(null);
  const [selectedSize, setSelectedSize] = useState<BoxSizeRow | null>(null);
  const [fillQty, setFillQty] = useState<Record<number, number>>({});
  const [extraQty, setExtraQty] = useState<Record<number, number>>({});

  useEffect(() => {
    Promise.all([
      supabase.from("menu_categories").select("id, name, is_buildable_box").order("display_order"),
      supabase.from("box_sizes").select("id, category_id, name, price, capacity_grams, is_available").eq("is_available", true).order("display_order"),
      supabase.from("box_fill_components").select("id, category_id, menu_item_id, grams_per_unit, is_available").eq("is_available", true).order("display_order"),
      supabase.from("box_extra_suggestions").select("id, category_id, menu_item_id, is_available").eq("is_available", true).order("display_order"),
      supabase.from("menu_items").select("id, category_id, name, price, image_url").eq("is_available", true),
    ]).then(([categoriesRes, sizesRes, fillsRes, extrasRes, itemsRes]) => {
      const allCategories = (categoriesRes.data as (BoxCategory & { is_buildable_box: boolean })[]) ?? [];
      setCategories(allCategories.filter((c) => c.is_buildable_box));
      setUpsellCategoryId(allCategories.find((c) => c.name === UPSELL_CATEGORY_NAME)?.id ?? null);
      setBoxSizes((sizesRes.data as BoxSizeRow[]) ?? []);
      setFillComponents((fillsRes.data as FillComponentRow[]) ?? []);
      setExtraSuggestions((extrasRes.data as ExtraSuggestionRow[]) ?? []);
      setMenuItems((itemsRes.data as MenuItemLite[]) ?? []);
      setLoading(false);
    });
  }, []);

  const itemById = useMemo(() => new Map(menuItems.map((i) => [i.id, i])), [menuItems]);

  const sizesForCategory = useMemo(
    () => (selectedCategory ? boxSizes.filter((s) => s.category_id === selectedCategory.id) : []),
    [boxSizes, selectedCategory],
  );
  const fillsForCategory = useMemo(
    () => (selectedCategory ? fillComponents.filter((f) => f.category_id === selectedCategory.id) : []),
    [fillComponents, selectedCategory],
  );
  const extrasForCategory = useMemo(
    () => (selectedCategory ? extraSuggestions.filter((e) => e.category_id === selectedCategory.id) : []),
    [extraSuggestions, selectedCategory],
  );
  const upsellItems = useMemo(
    () => (upsellCategoryId ? menuItems.filter((i) => i.category_id === upsellCategoryId) : []),
    [menuItems, upsellCategoryId],
  );

  const totalGrams = useMemo(
    () =>
      fillsForCategory.reduce((sum, f) => sum + (fillQty[f.menu_item_id] ?? 0) * f.grams_per_unit, 0),
    [fillsForCategory, fillQty],
  );
  const extrasTotal = useMemo(
    () =>
      extrasForCategory.reduce((sum, e) => {
        const item = itemById.get(e.menu_item_id);
        return sum + (item ? (extraQty[e.menu_item_id] ?? 0) * item.price : 0);
      }, 0),
    [extrasForCategory, extraQty, itemById],
  );

  function resetWizard() {
    setStep("type");
    setSelectedCategory(null);
    setSelectedSize(null);
    setFillQty({});
    setExtraQty({});
  }

  function pickCategory(category: BoxCategory) {
    setSelectedCategory(category);
    setStep("size");
  }

  function pickSize(size: BoxSizeRow) {
    setSelectedSize(size);
    setFillQty({});
    setStep("fill");
  }

  function changeFillQty(menuItemId: number, gramsPerUnit: number, delta: number) {
    setFillQty((prev) => {
      const current = prev[menuItemId] ?? 0;
      const next = Math.max(0, current + delta);
      if (delta > 0 && selectedSize && totalGrams + gramsPerUnit > selectedSize.capacity_grams) return prev;
      return { ...prev, [menuItemId]: next };
    });
  }

  function changeExtraQty(menuItemId: number, delta: number) {
    setExtraQty((prev) => {
      const next = Math.max(0, Math.min(10, (prev[menuItemId] ?? 0) + delta));
      return { ...prev, [menuItemId]: next };
    });
  }

  function finishBox() {
    if (!selectedCategory || !selectedSize) return;
    cart.addBuiltBox({
      box_size_id: selectedSize.id,
      price: selectedSize.price,
      categoryName: selectedCategory.name,
      sizeName: selectedSize.name,
      capacityGrams: selectedSize.capacity_grams,
      fills: fillsForCategory
        .filter((f) => (fillQty[f.menu_item_id] ?? 0) > 0)
        .map((f) => ({
          menu_item_id: f.menu_item_id,
          name: itemById.get(f.menu_item_id)?.name ?? `منتج #${f.menu_item_id}`,
          grams_per_unit: f.grams_per_unit,
          quantity: fillQty[f.menu_item_id],
        })),
      extras: extrasForCategory
        .filter((e) => (extraQty[e.menu_item_id] ?? 0) > 0)
        .map((e) => ({
          menu_item_id: e.menu_item_id,
          name: itemById.get(e.menu_item_id)?.name ?? `منتج #${e.menu_item_id}`,
          price: itemById.get(e.menu_item_id)?.price ?? 0,
          quantity: extraQty[e.menu_item_id],
        })),
    });
    setStep(extrasForCategory.length > 0 || upsellItems.length > 0 ? "upsell" : "type");
    if (extrasForCategory.length === 0 && upsellItems.length === 0) resetWizard();
  }

  if (loading) return <p className="muted centered-page">جاري التحميل...</p>;

  if (categories.length === 0) {
    // Nothing configured yet (MenuManagement.tsx's box-builder section is
    // where a category gets marked buildable) - fail open to the plain
    // menu link rather than showing an empty wizard.
    return (
      <section className="section">
        <h2 className="section-title">المنيو</h2>
        <p className="muted">اطلب من المنيو مباشرة.</p>
      </section>
    );
  }

  return (
    <section className="section box-builder">
      {step === "type" && (
        <>
          <h1 className="box-builder-title">اصنع وجبتك بنفسك</h1>
          <p className="muted">اختار النوع، وبعدين املا العلبة بنفسك زي ما إنت عايز بالظبط</p>
          <div className="category-grid" style={{ marginTop: "var(--space-4)" }}>
            {categories.map((c) => (
              <button key={c.id} className="category-card" onClick={() => pickCategory(c)}>
                <h3>{c.name}</h3>
                <p>اضغط تبدأ تركيب العلبة</p>
              </button>
            ))}
          </div>
        </>
      )}

      {step === "size" && selectedCategory && (
        <>
          <button className="btn-link" onClick={() => setStep("type")}>{"← رجوع"}</button>
          <h2 className="section-title">اختار حجم العلبة - {selectedCategory.name}</h2>
          {sizesForCategory.length === 0 && <p className="muted">مفيش أحجام متاحة للقسم ده دلوقتي.</p>}
          <div className="category-grid">
            {sizesForCategory.map((size) => (
              <button key={size.id} className="category-card" onClick={() => pickSize(size)}>
                <h3>{size.name}</h3>
                <p>{size.price} ج - سعة {size.capacity_grams} جرام</p>
              </button>
            ))}
          </div>
        </>
      )}

      {step === "fill" && selectedCategory && selectedSize && (
        <>
          <button className="btn-link" onClick={() => setStep("size")}>{"← رجوع"}</button>
          <h2 className="section-title">املا علبتك - {selectedSize.name}</h2>

          <BoxVisual
            capacityGrams={selectedSize.capacity_grams}
            totalGrams={totalGrams}
            layers={fillsForCategory
              .filter((f) => (fillQty[f.menu_item_id] ?? 0) > 0)
              .map((f, idx) => ({
                grams: (fillQty[f.menu_item_id] ?? 0) * f.grams_per_unit,
                color: LAYER_COLORS[idx % LAYER_COLORS.length],
                label: itemById.get(f.menu_item_id)?.name ?? "",
              }))}
          />

          <div className="photo-grid" style={{ marginTop: "var(--space-4)" }}>
            {fillsForCategory.map((f) => {
              const item = itemById.get(f.menu_item_id);
              if (!item) return null;
              const qty = fillQty[f.menu_item_id] ?? 0;
              const wouldExceed = totalGrams + f.grams_per_unit > selectedSize.capacity_grams;
              return (
                <div key={f.id} className="photo-card">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="photo-card-image" />
                  ) : (
                    <div className="photo-card-image placeholder-image" />
                  )}
                  <div className="photo-card-body">
                    <h3>{item.name}</h3>
                    <p className="muted photo-card-desc">{f.grams_per_unit} جرام للوحدة - مجاني جوه السعة</p>
                    <div className="box-builder-stepper">
                      <button className="btn-sm btn-ghost" disabled={qty === 0} onClick={() => changeFillQty(f.menu_item_id, f.grams_per_unit, -1)}>
                        −
                      </button>
                      <span>{qty}</span>
                      <button className="btn-sm btn-primary" disabled={wouldExceed} onClick={() => changeFillQty(f.menu_item_id, f.grams_per_unit, 1)}>
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            className="btn btn-primary btn-lg"
            style={{ marginTop: "var(--space-4)" }}
            onClick={() => setStep(extrasForCategory.length > 0 ? "extras" : "upsell")}
          >
            {extrasForCategory.length > 0 ? "التالي - الإضافات" : "خلصت العلبة"}
          </button>
        </>
      )}

      {step === "extras" && selectedCategory && selectedSize && (
        <>
          <button className="btn-link" onClick={() => setStep("fill")}>{"← رجوع"}</button>
          <h2 className="section-title">عايز تزود حاجة؟</h2>
          <p className="muted">دي بتتحسب بسعرها لوحدها فوق سعر العلبة</p>
          <div className="photo-grid" style={{ marginTop: "var(--space-3)" }}>
            {extrasForCategory.map((e) => {
              const item = itemById.get(e.menu_item_id);
              if (!item) return null;
              const qty = extraQty[e.menu_item_id] ?? 0;
              return (
                <div key={e.id} className="photo-card">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="photo-card-image" />
                  ) : (
                    <div className="photo-card-image placeholder-image" />
                  )}
                  <div className="photo-card-body">
                    <h3>{item.name}</h3>
                    <p className="menu-card-price">{item.price} ج</p>
                    <div className="box-builder-stepper">
                      <button className="btn-sm btn-ghost" disabled={qty === 0} onClick={() => changeExtraQty(e.menu_item_id, -1)}>
                        −
                      </button>
                      <span>{qty}</span>
                      <button className="btn-sm btn-primary" onClick={() => changeExtraQty(e.menu_item_id, 1)}>
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn btn-primary btn-lg" style={{ marginTop: "var(--space-4)" }} onClick={finishBox}>
            أضف العلبة للسلة - {(selectedSize.price + extrasTotal).toFixed(2)} ج
          </button>
        </>
      )}

      {step === "upsell" && (
        <>
          <h2 className="section-title">اتضافت العلبة للسلة 🎉</h2>
          {upsellItems.length > 0 && (
            <>
              <p className="muted">حابب تزود حاجة من دول؟</p>
              <div className="photo-grid" style={{ marginTop: "var(--space-3)" }}>
                {upsellItems.map((item) => (
                  <div key={item.id} className="photo-card">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} className="photo-card-image" />
                    ) : (
                      <div className="photo-card-image placeholder-image" />
                    )}
                    <div className="photo-card-body">
                      <h3>{item.name}</h3>
                      <div className="photo-card-footer">
                        <span className="menu-card-price">{item.price} ج</span>
                        <button
                          className="btn btn-primary"
                          onClick={() =>
                            cart.addLine({ key: `item-${item.id}`, menu_item_id: item.id, name: item.name, unit_price: item.price })
                          }
                        >
                          أضف
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="row" style={{ marginTop: "var(--space-4)" }}>
            <button className="btn btn-primary btn-lg" onClick={() => navigate("/checkout")}>
              كمل للدفع
            </button>
            <button className="btn btn-ghost btn-lg" onClick={resetWizard}>
              اصنع علبة تانية
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function BoxVisual({
  capacityGrams,
  totalGrams,
  layers,
}: {
  capacityGrams: number;
  totalGrams: number;
  layers: { grams: number; color: string; label: string }[];
}) {
  const fillPercent = Math.min(100, (totalGrams / capacityGrams) * 100);
  return (
    <div className="box-visual-wrap">
      <div className="box-visual">
        {layers.map((layer, idx) => (
          <div
            key={idx}
            className="box-visual-layer"
            style={{ height: `${(layer.grams / capacityGrams) * 100}%`, background: layer.color }}
            title={`${layer.label} - ${layer.grams}ج`}
          >
            {layer.grams / capacityGrams > 0.12 && <span>{layer.label}</span>}
          </div>
        ))}
        {layers.length === 0 && <p className="box-visual-empty">العلبة فاضية - ابدأ اختار المكوّنات</p>}
      </div>
      <p className={`box-visual-gauge${fillPercent >= 100 ? " box-visual-gauge-full" : ""}`}>
        {totalGrams} / {capacityGrams} جرام
      </p>
    </div>
  );
}
