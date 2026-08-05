import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";
import { CHART_COLORS } from "../lib/chartColors";

interface DriverRow {
  id: string;
  name: string;
  branch_id: number | null;
  is_active: boolean;
}

interface OrderRow {
  driver_id: string | null;
  status: string;
  dispatch_time: string | null;
  delivered_time: string | null;
  is_delayed: boolean | null;
}

interface DriverStats {
  driver: DriverRow;
  deliveredCount: number;
  avgMinutes: number | null;
  delayedCount: number;
}

export function DriverPerformance({ profile }: { profile: Profile }) {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("users").select("id, name, branch_id, is_active").eq("role", "driver").order("name"),
      supabase.from("orders").select("driver_id, status, dispatch_time, delivered_time, is_delayed"),
    ]).then(([driversRes, ordersRes]) => {
      setDrivers((driversRes.data as DriverRow[]) ?? []);
      setOrders((ordersRes.data as OrderRow[]) ?? []);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats: DriverStats[] = useMemo(() => {
    return drivers.map((driver) => {
      const driverOrders = orders.filter((o) => o.driver_id === driver.id);
      const delivered = driverOrders.filter((o) => o.status === "delivered" && o.dispatch_time && o.delivered_time);
      const totalMinutes = delivered.reduce((sum, o) => {
        const mins = (new Date(o.delivered_time as string).getTime() - new Date(o.dispatch_time as string).getTime()) / 60000;
        return sum + mins;
      }, 0);
      return {
        driver,
        deliveredCount: delivered.length,
        avgMinutes: delivered.length > 0 ? Math.round(totalMinutes / delivered.length) : null,
        delayedCount: driverOrders.filter((o) => o.is_delayed).length,
      };
    });
  }, [drivers, orders]);

  if (loading) return <p className="muted">جاري التحميل...</p>;

  const chartData = stats
    .filter((s) => s.avgMinutes != null)
    .map((s) => ({ name: s.driver.name, "متوسط التوصيل (د)": s.avgMinutes as number }));

  return (
    <div className="card chart-card">
      <h2>أداء الطيارين ({stats.length})</h2>
      {stats.length === 0 && <p className="muted">مفيش طيارين ضمن نطاقك.</p>}

      {chartData.length > 0 && (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: "Cairo" }} interval={0} angle={-25} textAnchor="end" height={70} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fontFamily: "Cairo" }} />
              <Tooltip contentStyle={{ fontFamily: "Cairo", direction: "rtl" }} />
              <Bar dataKey="متوسط التوصيل (د)" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {stats.length > 0 && (
        <div className="data-table-wrap" style={{ marginTop: "var(--space-3)" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>الطيار</th>
                <th>عدد الأوردرات</th>
                <th>متوسط التوصيل</th>
                <th>مرات التأخير</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(({ driver, deliveredCount, avgMinutes, delayedCount }) => (
                <tr key={driver.id}>
                  <td>
                    {driver.name}
                    {!driver.is_active && <span className="badge-inactive" style={{ marginRight: 8 }}>موقوف</span>}
                  </td>
                  <td className="num-cell">{deliveredCount}</td>
                  <td className="num-cell">{avgMinutes != null ? `${avgMinutes} د` : "-"}</td>
                  <td className={`num-cell${delayedCount > 0 ? " error-text" : ""}`}>{delayedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {profile.role === "general_manager" && (
        <p className="muted" style={{ marginTop: 12 }}>
          بتشوف كل طيارين الشركة (13 فرع).
        </p>
      )}
    </div>
  );
}
