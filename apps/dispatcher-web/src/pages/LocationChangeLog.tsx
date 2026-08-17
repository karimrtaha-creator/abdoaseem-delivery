import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

interface LocationChangeRow {
  id: number;
  address_id: number;
  order_id: number | null;
  driver_id: string | null;
  old_latitude: number | null;
  old_longitude: number | null;
  new_latitude: number | null;
  new_longitude: number | null;
  changed_at: string;
}

interface DriverLite {
  id: string;
  name: string;
  phone: string;
}

// general_manager-only log of every time a driver corrects a customer's
// saved delivery pin (0071) - populated automatically by a database
// trigger, this screen is purely a read-only view over it.
export function LocationChangeLog() {
  const [rows, setRows] = useState<LocationChangeRow[]>([]);
  const [drivers, setDrivers] = useState<Record<string, DriverLite>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase
        .from("customer_address_location_history")
        .select("id, address_id, order_id, driver_id, old_latitude, old_longitude, new_latitude, new_longitude, changed_at")
        .order("changed_at", { ascending: false })
        .limit(200),
      supabase.from("users").select("id, name, phone").eq("role", "driver"),
    ]).then(([historyRes, driversRes]) => {
      setRows((historyRes.data as LocationChangeRow[]) ?? []);
      const map: Record<string, DriverLite> = {};
      for (const d of (driversRes.data as DriverLite[]) ?? []) map[d.id] = d;
      setDrivers(map);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div className="card">
      <h2>سجل تعديلات مواقع العملاء ({rows.length})</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        كل مرة طيار يصحّح موقع عميل على الخريطة (لما يلاقي الموقع المسجل غلط) بتتسجل هنا أوتوماتيك - آخر ٢٠٠
        تعديل.
      </p>
      {rows.length === 0 && <p className="muted">مفيش تعديلات مواقع لسه.</p>}
      {rows.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>الطيار</th>
                <th>الأوردر</th>
                <th>الموقع القديم</th>
                <th>الموقع الجديد</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const driver = r.driver_id ? drivers[r.driver_id] : null;
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.changed_at).toLocaleString("ar-EG")}</td>
                    <td>{driver ? `${driver.name} (${driver.phone})` : r.driver_id ?? "-"}</td>
                    <td>{r.order_id ?? "-"}</td>
                    <td dir="ltr">
                      {r.old_latitude != null && r.old_longitude != null ? `${r.old_latitude}, ${r.old_longitude}` : "-"}
                    </td>
                    <td dir="ltr">
                      {r.new_latitude != null && r.new_longitude != null ? `${r.new_latitude}, ${r.new_longitude}` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
