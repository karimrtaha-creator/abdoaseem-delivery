import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useCart } from "../lib/CartContext";

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

export function Menu() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [combos, setCombos] = useState<ComboOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutNotice, setCheckoutNotice] = useState(false);
  const cart = useCart();

  useEffect(() => {
    Promise.all([
      supabase.from("menu_categories").select("id, name, display_order").order("display_order"),
      supabase.from("menu_items").select("id, category_id, name, price, is_available").eq("is_available", true),
      supabase.from("combo_offers").select("id, name, description, price, is_active").eq("is_active", true),
    ]).then(([categoriesRes, itemsRes, combosRes]) => {
      setCategories((categoriesRes.data as MenuCategory[]) ?? []);
      setItems((itemsRes.data as MenuItem[]) ?? []);
      setCombos((combosRes.data as ComboOffer[]) ?? []);
      setLoading(false);
    });
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

  function quantityOf(key: string) {
    return cart.lines.find((l) => l.key === key)?.quantity ?? 0;
  }

  if (loading) return <p className="muted centered-page">جاري تحميل المنيو...</p>;

  return (
    <div style={{ paddingBottom: cart.count > 0 ? "88px" : "0" }}>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" style={{ textDecoration: "none" }}>
            ABDO ASEEM
          </Link>
          <button className="btn btn-ghost">تسجيل الدخول</button>
        </div>
      </header>

      <div className="wrap">
        <h1 style={{ marginTop: "var(--space-4)" }}>المنيو</h1>

        {combos.length > 0 && (
          <section className="section" style={{ paddingBlock: "var(--space-4)" }}>
            <h2 className="section-title">الكومبوهات</h2>
            <div className="category-grid">
              {combos.map((combo) => {
                const key = `combo-${combo.id}`;
                const qty = quantityOf(key);
                return (
                  <div key={combo.id} className="menu-card">
                    <div>
                      <h3>{combo.name}</h3>
                      <p className="muted">{combo.description}</p>
                    </div>
                    <div className="menu-card-footer">
                      <span className="menu-card-price">{combo.price} ج</span>
                      <button
                        className="btn btn-primary"
                        onClick={() => cart.addLine({ key, combo_offer_id: combo.id, name: combo.name, unit_price: combo.price })}
                      >
                        {qty > 0 ? `أضف كمان (${qty})` : "أضف للسلة"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {categories.map((category) => {
          const categoryItems = itemsByCategory.get(category.id) ?? [];
          if (categoryItems.length === 0) return null;
          return (
            <section key={category.id} className="section" style={{ paddingBlock: "var(--space-4)" }}>
              <h2 className="section-title">{category.name}</h2>
              <div className="category-grid">
                {categoryItems.map((item) => {
                  const key = `item-${item.id}`;
                  const qty = quantityOf(key);
                  return (
                    <div key={item.id} className="menu-card">
                      <h3>{item.name}</h3>
                      <div className="menu-card-footer">
                        <span className="menu-card-price">{item.price} ج</span>
                        <button
                          className="btn btn-primary"
                          onClick={() => cart.addLine({ key, menu_item_id: item.id, name: item.name, unit_price: item.price })}
                        >
                          {qty > 0 ? `أضف كمان (${qty})` : "أضف للسلة"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {cart.count > 0 && (
        <div className="cart-bar">
          <div className="wrap cart-bar-inner">
            <span>
              {cart.count} صنف - <strong>{cart.total} ج</strong>
            </span>
            <button className="btn btn-primary btn-lg" onClick={() => setCheckoutNotice(true)}>
              استكمال الطلب
            </button>
          </div>
          {checkoutNotice && (
            <div className="wrap">
              <p className="muted" style={{ paddingBottom: "var(--space-2)" }}>
                شاشة الدفع وتأكيد الطلب لسه بننفذها - سلتك محفوظة وهتلاقيها لما نخلصها.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
