import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { DivIcon, LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";

// Only drivers who are actually out on a delivery show up here at all
// (see location_tracking_service.dart - the app only sends updates while
// it has an order out_for_delivery/delayed), but a driver can still sit
// in that state after their phone loses signal or the app gets killed -
// this cutoff hides a marker once its last update is old enough that
// showing it as "here" would be actively misleading.
const STALE_AFTER_MINUTES = 5;
const CAIRO_CENTER: [number, number] = [30.0444, 31.2357];

interface DriverLocation {
  id: string;
  name: string;
  current_lat: number;
  current_lng: number;
  location_updated_at: string;
  branch_id: number | null;
}

interface ActiveOrder {
  id: number;
  pos_order_id: string | null;
  driver_id: string | null;
  status: string;
}

interface BranchLite {
  id: number;
  name: string;
}

const driverIcon = new DivIcon({
  className: "driver-marker",
  html: `<div style="background:#1E6B52;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 0 4px rgba(0,0,0,0.4)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// profile isn't used for client-side filtering - RLS (0006's
// users_select_dispatcher_branch_drivers) already scopes which drivers a
// dispatcher can even see to their own branch; a team_leader/general_
// manager already sees everyone. Kept in the signature only so this
// screen matches every other tab's ScreenFor(tab, profile) call shape.
export function DriverLocations(_props: { profile: Profile }) {
  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [loading, setLoading] = useState(true);
  // Karim's request (2026-08-21): with drivers spread across 13 branches,
  // the unfiltered map got cluttered fast - a branch filter and a
  // name search narrow it down to "just what I'm looking for".
  const [branchFilter, setBranchFilter] = useState<number | "all">("all");
  const [nameSearch, setNameSearch] = useState("");

  async function load() {
    const staleThreshold = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000).toISOString();
    const [driversRes, ordersRes, branchesRes] = await Promise.all([
      supabase
        .from("users")
        .select("id, name, current_lat, current_lng, location_updated_at, branch_id")
        .eq("role", "driver")
        .not("current_lat", "is", null)
        .not("current_lng", "is", null)
        .gte("location_updated_at", staleThreshold),
      supabase
        .from("orders")
        .select("id, pos_order_id, driver_id, status")
        .in("status", ["out_for_delivery", "delayed"])
        .not("driver_id", "is", null),
      supabase.from("branches").select("id, name").order("name"),
    ]);
    setDrivers((driversRes.data as DriverLocation[]) ?? []);
    setActiveOrders((ordersRes.data as ActiveOrder[]) ?? []);
    setBranches((branchesRes.data as BranchLite[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Same realtime-refetch pattern used everywhere else in this app -
    // location updates land as plain UPDATEs on users, cheap to just
    // reload rather than track incremental diffs for a handful of drivers.
    const channel = supabase
      .channel("driver-locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => load())
      .subscribe();
    // Also catch orders finishing/cancelling so a driver who just delivered
    // drops off the map even before their next (nonexistent) location ping.
    const ordersChannel = supabase
      .channel("driver-locations-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();
    // Re-check every minute purely to expire stale markers even if
    // nothing in the DB changes in the meantime.
    const timer = setInterval(load, 60_000);
    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(ordersChannel);
      clearInterval(timer);
    };
  }, []);

  const orderByDriver = useMemo(() => {
    const map = new Map<string, ActiveOrder>();
    for (const o of activeOrders) {
      if (o.driver_id) map.set(o.driver_id, o);
    }
    return map;
  }, [activeOrders]);

  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: number | null) => (id ? map.get(id) ?? `فرع #${id}` : "بدون فرع");
  }, [branches]);

  const visibleDrivers = useMemo(() => {
    const search = nameSearch.trim().toLowerCase();
    return drivers.filter((d) => {
      if (branchFilter !== "all" && d.branch_id !== branchFilter) return false;
      if (search && !d.name.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [drivers, branchFilter, nameSearch]);

  const bounds = useMemo(() => {
    if (visibleDrivers.length === 0) return null;
    return new LatLngBounds(visibleDrivers.map((d) => [d.current_lat, d.current_lng] as [number, number]));
  }, [visibleDrivers]);

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      <div className="card">
        <p>
          طيارين ماشيين يوصّلوا دلوقتي: <strong>{drivers.length}</strong>
          {(branchFilter !== "all" || nameSearch.trim()) && <span className="muted"> (ظاهر منهم {visibleDrivers.length})</span>}
        </p>
        {drivers.length === 0 && (
          <p className="muted">مفيش طيار شايل أوردر معاه إذن الموقع مفعّل دلوقتي.</p>
        )}
        <div className="inline-row" style={{ marginTop: "var(--space-2)" }}>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">كل الفروع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="دوّر باسم الطيار"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <MapContainer
          center={CAIRO_CENTER}
          zoom={11}
          bounds={bounds ?? undefined}
          style={{ height: "70vh", width: "100%" }}
        >
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          {visibleDrivers.map((d) => {
            const order = orderByDriver.get(d.id);
            return (
              <Marker key={d.id} position={[d.current_lat, d.current_lng]} icon={driverIcon}>
                <Popup>
                  <strong>{d.name}</strong>
                  <br />
                  <span className="muted">{branchName(d.branch_id)}</span>
                  <br />
                  {order ? `أوردر #${order.pos_order_id ?? order.id}` : "من غير أوردر مرتبط حاليًا"}
                  <br />
                  <span className="muted">آخر تحديث: {new Date(d.location_updated_at).toLocaleTimeString("ar-EG")}</span>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
