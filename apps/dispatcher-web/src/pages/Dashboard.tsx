import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";
import { CHART_COLORS } from "../lib/chartColors";

interface OrderRow {
  id: number;
  pos_order_id: string | null;
  status: string;
  branch_id: number;
  driver_id: string | null;
  order_time: string;
  dispatch_time: string | null;
  delivered_time: string | null;
  sla_minutes: number | null;
  delay_minutes: number | null;
  is_delayed: boolean | null;
  payment_method: string;
}

interface Branch {
  id: number;
  name: string;
  region_id: number | null;
}

interface DriverLite {
  id: string;
  name: string;
}

const ONGOING_STATUSES = ["preparing", "out_for_delivery", "delayed"];

function csvEscape(value: string | number | boolean | null): string {
  const str = value == null ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCsv(filename: string, rows: (string | number | boolean | null)[][]) {
  // Leading BOM so Excel opens Arabic text as UTF-8 correctly instead of
  // guessing the wrong codepage and showing garbled characters.
  const csv = "﻿" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function Dashboard({ profile }: { profile: Profile }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<DriverLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusBranchId, setFocusBranchId] = useState<number | "all">("all");

  async function load() {
    const [ordersRes, branchesRes, driversRes] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, pos_order_id, status, branch_id, driver_id, order_time, dispatch_time, delivered_time, sla_minutes, delay_minutes, is_delayed, payment_method",
        ),
      supabase.from("branches").select("id, name, region_id"),
      supabase.from("users").select("id, name").eq("role", "driver"),
    ]);
    setOrders((ordersRes.data as OrderRow[]) ?? []);
    setBranches((branchesRes.data as Branch[]) ?? []);
    setDrivers((driversRes.data as DriverLite[]) ?? []);
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

  function exportDailyReport() {
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const driverName = new Map(drivers.map((d) => [d.id, d.name]));
    const todaysOrders = visibleOrders.filter((o) => o.order_time >= startOfDayIso);

    const header = [
      "رقم الأوردر",
      "رقم الكاشير",
      "الفرع",
      "الحالة",
      "الطيار",
      "وقت الطلب",
      "وقت الخروج",
      "وقت التسليم",
      "SLA (دقيقة)",
      "التأخير (دقيقة)",
      "متأخر؟",
      "طريقة الدفع",
    ];
    const rows = todaysOrders.map((o) => [
      o.id,
      o.pos_order_id,
      branchName.get(o.branch_id) ?? o.branch_id,
      o.status,
      o.driver_id ? driverName.get(o.driver_id) ?? o.driver_id : "",
      o.order_time,
      o.dispatch_time,
      o.delivered_time,
      o.sla_minutes,
      o.delay_minutes,
      o.is_delayed ? "نعم" : "لا",
      o.payment_method,
    ]);

    const todayLabel = new Date().toISOString().slice(0, 10);
    downloadCsv(`تقرير-يومي-${todayLabel}.csv`, [header, ...rows]);
  }

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

      <div className="card">
        <button className="btn-primary" onClick={exportDailyReport}>
          تصدير التقرير اليومي (CSV)
        </button>
      </div>

      {focusBranchId === "all" && scopedBranches.length > 1 && (
        <div className="card chart-card">
          <h2>توزيع الفروع</h2>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perBranch.map((p) => ({ name: p.branch.name, جارية: p.ongoing, متأخرة: p.delayed, اتسلمت: p.deliveredToday }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: "Cairo" }} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fontFamily: "Cairo" }} />
                <Tooltip contentStyle={{ fontFamily: "Cairo", direction: "rtl" }} />
                <Legend wrapperStyle={{ fontFamily: "Cairo", fontSize: 12 }} />
                {/* isAnimationActive=false: react-smooth's bar-grow animation relies
                    on requestAnimationFrame, which some environments throttle or
                    never fire for background/unfocused tabs - when that happens the
                    bar gets stuck on its zero-height first frame and never paints.
                    Disabling the animation renders the final shape immediately. */}
                <Bar dataKey="جارية" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="متأخرة" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="اتسلمت" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="data-table-wrap" style={{ marginTop: "var(--space-3)" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>الفرع</th>
                  <th>جارية</th>
                  <th>متأخرة</th>
                  <th>اتسلمت النهاردة</th>
                </tr>
              </thead>
              <tbody>
                {perBranch.map(({ branch, ongoing, delayed, deliveredToday }) => (
                  <tr key={branch.id}>
                    <td>{branch.name}</td>
                    <td className="num-cell">{ongoing}</td>
                    <td className={`num-cell${delayed > 0 ? " error-text" : ""}`}>{delayed}</td>
                    <td className="num-cell">{deliveredToday}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
