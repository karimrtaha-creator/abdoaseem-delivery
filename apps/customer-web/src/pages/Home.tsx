import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { OffersRibbon } from "../components/OffersRibbon";

interface MenuCategory {
  id: number;
  name: string;
  display_order: number;
}

const CATEGORY_BLURBS: Record<string, string> = {
  الكشري: "طبقات رز وعدس ومكرونة وحمص، وصلصة الدقة والبصل المقرمش فوق",
  الطواجن: "فراخ ولحمة وخضار، على النار لحد ما تستوي",
  الحلو: "أرز باللبن وحلويات بسيطة تقفل بيها الوجبة",
  المشروبات: "كولا ومياه ومشروبات باردة",
  اضافات: "زود وجبتك بإضافات على مزاجك",
};

export function Home() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [hasStartedOrder, setHasStartedOrder] = useState(false);

  useEffect(() => {
    supabase
      .from("menu_categories")
      .select("id, name, display_order")
      .order("display_order")
      .then(({ data }) => setCategories((data as MenuCategory[]) ?? []));
  }, []);

  return (
    <div>
      <header className="site-header">
        <div className="wrap">
          <span className="brand">ABDO ASEEM</span>
          <button className="btn btn-ghost">تسجيل الدخول</button>
        </div>
      </header>

      <div className="wrap">
        <section className="hero">
          <div className="hero-card">
            <h1>كشري الغباشي</h1>
            <p>ساخن ومقرمش زي ما اتعودت بالظبط - يوصلك لحد باب البيت في دقايق.</p>
            <div className="row">
              <button className="btn btn-primary btn-lg" onClick={() => setHasStartedOrder(true)}>
                اطلب دلوقتي
              </button>
              <button className="btn btn-ghost btn-lg">شوف المنيو</button>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">المنيو</h2>
          <div className="category-grid">
            {categories.map((c) => (
              <button key={c.id} className="category-card" onClick={() => setHasStartedOrder(true)}>
                <h3>{c.name}</h3>
                <p>{CATEGORY_BLURBS[c.name] ?? "تصفح الأصناف"}</p>
              </button>
            ))}
            {categories.length === 0 && <p className="muted">جاري تحميل المنيو...</p>}
          </div>
        </section>
      </div>

      <footer className="site-footer">
        <div className="wrap footer-grid">
          <div>
            <h3>اطلب من غير الموقع كمان</h3>
            <p className="muted">الخط الساخن (كول سنتر)</p>
            <a className="footer-number" href="tel:19860">19860</a>
          </div>
          <div>
            <p className="muted">واتساب</p>
            <a className="footer-link" href="https://wa.me/201224444219">01224444219</a>
            <a className="footer-link" href="https://wa.me/201224444218">01224444218</a>
          </div>
          <div>
            <p className="muted">تحويل انستاباي</p>
            <p className="footer-link">01040421166</p>
            <p className="muted">باسم أ. عبد الباقي</p>
          </div>
        </div>
      </footer>

      <OffersRibbon hasStartedOrder={hasStartedOrder} />
    </div>
  );
}
