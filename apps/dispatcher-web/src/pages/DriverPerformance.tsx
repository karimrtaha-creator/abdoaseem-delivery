import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";

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

  return (
    <div className="card">
      <h2>أداء الطيارين ({stats.length})</h2>
      {stats.length === 0 && <p className="muted">مفيش طيارين ضمن نطاقك.</p>}
      <div className="order-list">
        {stats.map(({ driver, deliveredCount, avgMinutes, delayedCount }) => (
          <div key={driver.id} className="order-row" style={{ cursor: "default" }}>
            <span className="order-row-id">
              {driver.name}
              {!driver.is_active && <span className="badge-delayed">موقوف</span>}
            </span>
            <span className="muted">عدد الأوردرات: {deliveredCount}</span>
            <span className="muted">متوسط التوصيل: {avgMinutes != null ? `${avgMinutes} د` : "-"}</span>
            <span className={delayedCount > 0 ? "error-text" : "muted"}>مرات التأخير: {delayedCount}</span>
          </div>
        ))}
      </div>
      {profile.role === "general_manager" && (
        <p className="muted" style={{ marginTop: 12 }}>
          بتشوف كل طيارين الشركة (13 فرع).
        </p>
      )}
    </div>
  );
}
