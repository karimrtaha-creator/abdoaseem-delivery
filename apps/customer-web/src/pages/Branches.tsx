import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabaseClient";

interface Branch {
  id: number;
  name: string;
  region_id: number | null;
  address: string | null;
  photo_url: string | null;
}
interface Region {
  id: number;
  name: string;
}

export function Branches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [columnsMissing, setColumnsMissing] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("branches").select("id, name, region_id, address, photo_url").order("name"),
      supabase.from("regions").select("id, name").order("name"),
    ]).then(([branchesRes, regionsRes]) => {
      if (branchesRes.error) {
        // 42703 = column does not exist - migration 0011 not applied yet
        if (branchesRes.error.code === "42703" || branchesRes.error.message.includes("does not exist")) {
          setColumnsMissing(true);
        }
      } else {
        setBranches((branchesRes.data as Branch[]) ?? []);
      }
      setRegions((regionsRes.data as Region[]) ?? []);
      setLoading(false);
    });
  }, []);

  const branchesByRegion = useMemo(() => {
    const map = new Map<number | "none", Branch[]>();
    for (const b of branches) {
      const key = b.region_id ?? "none";
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    return map;
  }, [branches]);

  if (loading) return <p className="muted centered-page">جاري التحميل...</p>;

  if (columnsMissing) {
    return (
      <div className="wrap section">
        <h1>فروعنا</h1>
        <p className="error-text">صفحة الفروع لسه محتاجة تحديث في قاعدة البيانات. كلم فريق التقنية.</p>
      </div>
    );
  }

  return (
    <div>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" style={{ textDecoration: "none" }}>
            ABDO ASEEM
          </Link>
          <Link to="/menu" className="btn btn-ghost">
            المنيو
          </Link>
        </div>
      </header>

      <div className="wrap section">
        <h1>فروعنا</h1>
        <p className="muted" style={{ marginTop: "var(--space-1)" }}>
          {branches.length} فرع بيخدموا كل المناطق دي
        </p>

        {regions.map((region) => {
          const regionBranches = branchesByRegion.get(region.id) ?? [];
          if (regionBranches.length === 0) return null;
          return (
            <section key={region.id} style={{ marginTop: "var(--space-5)" }}>
              <h2 className="section-title">{region.name}</h2>
              <div className="photo-grid">
                {regionBranches.map((b) => (
                  <div key={b.id} className="photo-card branch-card">
                    {b.photo_url ? (
                      <img src={b.photo_url} alt={b.name} className="photo-card-image" />
                    ) : (
                      <div className="photo-card-image placeholder-image" />
                    )}
                    <div className="photo-card-body">
                      <h3>{b.name}</h3>
                      <p className="muted">{b.address ?? "هنضيف العنوان قريبًا"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
