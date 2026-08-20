import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { OffersRibbon } from "../components/OffersRibbon";
import { useCart } from "../lib/CartContext";
import { useAuth } from "../lib/AuthContext";

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

const FACEBOOK_PAGE_URL = "https://www.facebook.com/share/1cjTyg58CM/?mibextid=wwXIfr";
const INSTAGRAM_URL = "https://www.instagram.com/koshry_el_ghobashy?igsh=MW82ZWlseTI0NWtn";

// Uploaded video files (promo-videos storage bucket) get played natively;
// anything else (Facebook share/watch links) goes through FB's embed
// plugin, which is the only reliable way to play a Facebook-hosted video
// outside facebook.com itself.
function isUploadedVideoFile(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

export function Home() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [promoVideos, setPromoVideos] = useState<{ id: number; video_url: string }[]>([]);
  const [promoVideoHeading, setPromoVideoHeading] = useState("شوفنا وإحنا بنطبخ");
  const navigate = useNavigate();
  const cart = useCart();
  const { profile, signOut } = useAuth();

  useEffect(() => {
    supabase
      .from("menu_categories")
      .select("id, name, display_order")
      .order("display_order")
      .then(({ data }) => setCategories((data as MenuCategory[]) ?? []));
    // Staff-editable from the Staff Portal (Business Hours screen) - see
    // migrations 0063/0067. Section is skipped entirely when the list is
    // empty, so removing every link is enough to take it down, no code
    // change needed.
    supabase
      .from("promo_videos")
      .select("id, video_url")
      .order("created_at")
      .then(({ data }) => setPromoVideos((data as { id: number; video_url: string }[]) ?? []));
    supabase
      .from("site_settings")
      .select("promo_video_heading")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { promo_video_heading: string } | null;
        if (row?.promo_video_heading) setPromoVideoHeading(row.promo_video_heading);
      });
  }, []);

  return (
    <div>
      <header className="site-header">
        <div className="wrap">
          <span className="brand">كشري الغباشي</span>
          {profile ? (
            <div className="user-chip">
              <span>أهلاً {profile.name || "بيك"}</span>
              <button className="btn-link" onClick={() => navigate("/orders")}>
                طلباتي
              </button>
              <button className="btn-link" onClick={() => navigate("/addresses")}>
                عناويني
              </button>
              <button className="btn-link" onClick={() => navigate("/settings")}>
                بياناتي
              </button>
              <button className="btn btn-ghost" onClick={() => signOut()}>
                خروج
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost" onClick={() => navigate("/login")}>
              تسجيل الدخول
            </button>
          )}
        </div>
      </header>

      <div className="wrap">
        <section className="hero">
          <div className="hero-card">
            <h1>كشري الغباشي</h1>
            <p>ساخن ومقرمش زي ما اتعودت بالظبط - يوصلك لحد باب البيت في دقايق.</p>
            <div className="row">
              <button className="btn btn-primary btn-lg" onClick={() => navigate("/menu")}>
                اطلب دلوقتي
              </button>
              <Link to="/menu" className="btn btn-ghost btn-lg">
                شوف المنيو
              </Link>
            </div>
          </div>
        </section>

        {promoVideos.length > 0 && (
          <section className="section" style={{ paddingBlock: "var(--space-4)" }}>
            <h2 className="section-title" style={{ textAlign: "center" }}>{promoVideoHeading}</h2>
            <div className="promo-video-list">
              {promoVideos.map((v) =>
                isUploadedVideoFile(v.video_url) ? (
                  <div className="promo-video-wrap" key={v.id}>
                    <video className="promo-video" src={v.video_url} controls playsInline />
                  </div>
                ) : (
                  <div className="promo-video-wrap" key={v.id}>
                    <iframe
                      className="promo-video"
                      src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(v.video_url)}&show_text=false`}
                      style={{ border: "none", overflow: "hidden" }}
                      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                      allowFullScreen
                      title="فيديو كشري الغباشي"
                    />
                  </div>
                ),
              )}
            </div>
          </section>
        )}

        <section className="section">
          <h2 className="section-title">المنيو</h2>
          <div className="category-grid">
            {categories.map((c) => (
              <button key={c.id} className="category-card" onClick={() => navigate("/menu")}>
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
            <p className="muted footer-note">التحويل على حساب بنكي - مش محفظة موبايل</p>
          </div>
          <div>
            <h3>فروعنا</h3>
            <Link to="/branches" className="footer-link">
              شوف أقرب فرع ليك
            </Link>
            <p className="muted" style={{ marginTop: "var(--space-2)" }}>
              تابعنا
            </p>
            <a className="footer-link" href={FACEBOOK_PAGE_URL} target="_blank" rel="noreferrer">
              فيسبوك
            </a>
            <a className="footer-link" href={INSTAGRAM_URL} target="_blank" rel="noreferrer">
              انستجرام
            </a>
          </div>
        </div>
        <div className="wrap">
          <p className="muted footer-hashtag">#الغباشي_دايما_جنبك</p>
        </div>
      </footer>

      <OffersRibbon hasStartedOrder={cart.count > 0} />
    </div>
  );
}
