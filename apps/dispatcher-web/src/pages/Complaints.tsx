import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

interface Complaint {
  id: number;
  order_id: number;
  driver_id: string | null;
  branch_id: number;
  type: string;
  description: string;
  created_at: string;
  status: "open" | "resolved";
}

interface Branch {
  id: number;
  name: string;
}

interface DriverLite {
  id: string;
  name: string;
}

const TYPE_LABELS: Record<string, string> = {
  delay: "تأخير",
  bad_behavior: "سوء تعامل",
  wrong_order: "أوردر غلط",
  missing_items: "أصناف ناقصة",
  other: "أخرى",
};

export function Complaints() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<DriverLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    const [complaintsRes, branchesRes, driversRes] = await Promise.all([
      supabase.from("complaints").select("*").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name"),
      supabase.from("users").select("id, name").eq("role", "driver"),
    ]);
    setComplaints((complaintsRes.data as Complaint[]) ?? []);
    setBranches((branchesRes.data as Branch[]) ?? []);
    setDrivers((driversRes.data as DriverLite[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("complaints-screen")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: number) => map.get(id) ?? `فرع #${id}`;
  }, [branches]);

  const driverName = useMemo(() => {
    const map = new Map(drivers.map((d) => [d.id, d.name]));
    return (id: string | null) => (id ? map.get(id) ?? id : "-");
  }, [drivers]);

  const visible = filter === "open" ? complaints.filter((c) => c.status === "open") : complaints;

  async function resolve(id: number) {
    setBusyId(id);
    await supabase.from("complaints").update({ status: "resolved" }).eq("id", id);
    setBusyId(null);
    load();
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div className="card">
      <div className="inline-row" style={{ justifyContent: "space-between" }}>
        <h2>الشكاوى ({visible.length})</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "open" | "all")}>
          <option value="open">المفتوحة بس</option>
          <option value="all">كل الشكاوى</option>
        </select>
      </div>
      {visible.length === 0 && <p className="muted">مفيش شكاوى{filter === "open" ? " مفتوحة" : ""}.</p>}
      <div className="order-list">
        {visible.map((c) => (
          <div key={c.id} className="card pending-order-card">
            <div className="pending-order-header">
              <strong>
                شكوى #{c.id} - أوردر #{c.order_id}
              </strong>
              <span className="muted">{branchName(c.branch_id)}</span>
            </div>
            <p className="muted">
              {TYPE_LABELS[c.type] ?? c.type} - الطيار: {driverName(c.driver_id)} -{" "}
              {new Date(c.created_at).toLocaleString("ar-EG")}
            </p>
            <p>{c.description}</p>
            {c.status === "open" ? (
              <button className="btn-primary" disabled={busyId === c.id} onClick={() => resolve(c.id)}>
                تحديد كمحلولة
              </button>
            ) : (
              <span className="badge-new">اتحلت</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
