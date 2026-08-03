import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";

interface OrderRow {
  id: number;
  status: string;
  branch_id: number;
  delivered_time: string | null;
}

interface Branch {
  id: number;
  name: string;
  region_id: number | null;
}

const ONGOING_STATUSES = ["preparing", "out_for_delivery", "delayed"];

export function Dashboard({ profile }: { profile: Profile }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusBranchId, setFocusBranchId] = useState<number | "all">("all");

  async function load() {
    const [ordersRes, branchesRes] = await Promise.all([
      supabase.from("orders").select("id, status, branch_id, delivered_time"),
      supabase.from("branches").select("id, name, region_id"),
    ]);
    setOrders((ordersRes.data as OrderRow[]) ?? []);
    setBranches((branchesRes.data as Branch[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("dashboard-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Branches this role is even allowed to focus on - drives the dropdown
  // options. Actual data scoping already happened server-side via RLS
  // (`orders`/`branches` only ever return rows this role can see), this
  // is just which of those visible branches to additionally filter by.
  const scopedBranches = useMemo(() => {
    if (profile.role === "branch_manager") return branches.filter((b) => b.id === profile.branch_id);
    if (profile.role === "regional_manager") return branches.filter((b) => b.region_id === profile.region_id);
    return branches;
  }, [branches, profile.role, profile.branch_id, profile.region_id]);

  useEffect(() => {
    if (profile.role === "branch_manager" && profile.branch_id) {
      setFocusBranchId(profile.branch_id);
    }
  }, [profile.role, profile.branch_id]);

  const visibleOrders = useMemo(
    () => (focusBranchId === "all" ? orders : orders.filter((o) => o.branch_id === focusBranchId)),
    [orders, focusBranchId],
  );

  const startOfDayIso = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const ongoingCount = visibleOrders.filter((o) => ONGOING_STATUSES.includes(o.status)).length;
  const delayedCount = visibleOrders.filter((o) => o.status === "delayed").length;
  const deliveredTodayCount = visibleOrders.filter(
    (o) => o.status === "delivered" && o.delivered_time && o.delivered_time >= startOfDayIso,
  ).length;

  const perBranch = useMemo(() => {
    return scopedBranches.map((b) => {
      const branchOrders = orders.filter((o) => o.branch_id === b.id);
      return {
        branch: b,
        ongoing: branchOrders.filter((o) => ONGOING_STATUSES.includes(o.status)).length,
        delayed: branchOrders.filter((o) => o.status === "delayed").length,
        deliveredToday: branchOrders.filter(
          (o) => o.status === "delivered" && o.delivered_time && o.delivered_time >= startOfDayIso,
        ).length,
      };
    });
  }, [scopedBranches, orders, startOfDayIso]);

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      {profile.role !== "branch_manager" && scopedBranches.length > 1 && (
        <div className="card">
          <label>
            التركيز على
            <select value={focusBranchId} onChange={(e) => setFocusBranchId(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">كل الفروع اللي تحت إدارتك</option>
              {scopedBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-value">{ongoingCount}</span>
          <span className="stat-label">أوردرات جارية</span>
        </div>
        <div className="stat-tile stat-tile-danger">
          <span className="stat-value">{delayedCount}</span>
          <span className="stat-label">متأخرة</span>
        </div>
        <div className="stat-tile stat-tile-success">
          <span className="stat-value">{deliveredTodayCount}</span>
          <span className="stat-label">اتسلمت النهاردة</span>
        </div>
      </div>

      {focusBranchId === "all" && scopedBranches.length > 1 && (
        <div className="card">
          <h2>توزيع الفروع</h2>
          <div className="order-list">
            {perBranch.map(({ branch, ongoing, delayed, deliveredToday }) => (
              <div key={branch.id} className="order-row" style={{ cursor: "default" }}>
                <span className="order-row-id">{branch.name}</span>
                <span className="muted">جارية: {ongoing}</span>
                <span className={delayed > 0 ? "error-text" : "muted"}>متأخرة: {delayed}</span>
                <span className="muted">اتسلمت: {deliveredToday}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
