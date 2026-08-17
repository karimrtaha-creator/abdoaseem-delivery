import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../supabaseClient";
import { CHART_COLORS } from "../lib/chartColors";

interface Branch {
  id: number;
  name: string;
  region_id: number | null;
  is_delivery_available: boolean;
  delivery_fee: number;
  photo_url: string | null;
  address: string | null;
}

interface DeliveryZone {
  id: number;
  branch_id: number;
  zone_name: string;
  delivery_fee: number;
  is_active: boolean;
}

interface OrderItemLite {
  unit_price: number;
  quantity: number;
}

interface OrderStatRow {
  branch_id: number;
  status: string;
  order_time: string;
  // Only present on the wider company-summary query, not strictly needed
  // by the per-branch pending/completed/failed breakdown below.
  delivery_fee_after_tax: number | null;
  order_items: OrderItemLite[];
}

// "Completed" = reached a terminal, successful state today; anything else
// today (still pending_acceptance/preparing/ready_for_driver/
// out_for_delivery/delayed) counts as "Pending" - the two always sum to
// the day's total, matching the 124 = 8 + 116 shape from the spec.
// cancelled/rejected orders still count toward the day's total (they did
// happen today) but aren't "pending" (nothing left to do) or "completed"
// (didn't succeed) - shown as a third, separate figure rather than folded
// into either bucket, which would misrepresent one of them.
const TERMINAL_SUCCESS = "delivered";
const TERMINAL_FAILURE = ["cancelled", "rejected"];

// Real public.order_status enum values (confirmed live via
// `enum_range(NULL::order_status)`), each mapped to the Arabic label
// already used elsewhere in this app (AcceptanceLobby.tsx) where one
// exists, so the same status doesn't read differently on two screens.
// No status is invented here - "قيد التوصيل" (out_for_delivery) and
// "متأخر" (delayed) aren't in the minimum list Karim asked for, but both
// are real, distinct pipeline stages that would otherwise silently
// disappear into "قيد التنفيذ" - hiding a delayed order inside "Preparing"
// on a page whose whole purpose is "understand the situation at a glance"
// would defeat the point.
const STATUS_ORDER = [
  "pending_acceptance",
  "preparing",
  "ready_for_driver",
  "out_for_delivery",
  "delayed",
  "delivered",
  "cancelled",
  "rejected",
] as const;

const STATUS_LABELS: Record<string, string> = {
  pending_acceptance: "قيد الانتظار",
  preparing: "قيد التنفيذ",
  ready_for_driver: "جاهز",
  out_for_delivery: "قيد التوصيل",
  delayed: "متأخر",
  delivered: "مكتمل",
  cancelled: "ملغي",
  rejected: "مرفوض",
};

interface Region {
  id: number;
  name: string;
}

interface StaffUser {
  id: string;
  name: string;
  phone: string;
  role: string;
  branch_id: number | null;
  region_id: number | null;
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke(name, {
    body: body as any,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (error) throw new Error(error.message);
  return data as T;
}

export function BranchManagement() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [todaysOrders, setTodaysOrders] = useState<OrderStatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Which branch's admin controls (photo/fee/delivery-toggle/manager
  // assignment) are expanded - collapsed by default so the overview table
  // stays readable at a glance, per the "clear, professional" ask.
  const [expandedBranchId, setExpandedBranchId] = useState<number | null>(null);

  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchRegion, setNewBranchRegion] = useState<number | "">("");
  const [newRegionName, setNewRegionName] = useState("");

  const [pickBranchManager, setPickBranchManager] = useState<Record<number, string>>({});
  const [pickRegionManager, setPickRegionManager] = useState<Record<number, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feeDrafts, setFeeDrafts] = useState<Record<number, string>>({});
  const [zoneFeeDrafts, setZoneFeeDrafts] = useState<Record<number, string>>({});
  const [newZoneDrafts, setNewZoneDrafts] = useState<Record<number, { name: string; fee: string }>>({});
  const [uploadingPhotoId, setUploadingPhotoId] = useState<number | null>(null);

  async function load() {
    const startOfDayIso = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    })();
    const [branchesRes, regionsRes, staffRes, zonesRes, ordersRes] = await Promise.all([
      supabase.from("branches").select("id, name, region_id, is_delivery_available, delivery_fee, photo_url, address").order("name"),
      supabase.from("regions").select("id, name").order("name"),
      supabase.from("users").select("id, name, phone, role, branch_id, region_id").neq("role", "customer").order("name"),
      // Karim's 2026-08-13 correction: delivery_zones (per-branch,
      // per-zone fees) is the real pricing model, branches.delivery_fee is
      // only a fallback - the "Branches" table/panel now reflects that.
      supabase.from("delivery_zones").select("id, branch_id, zone_name, delivery_fee, is_active").order("zone_name"),
      // Real per-branch AND company-wide order counts/sales, computed from
      // today's actual orders - no mock/fixed numbers anywhere here.
      // order_items is embedded (not a separate query) so "sales" is the
      // real sum of unit_price*quantity actually stored on each order's
      // lines; delivery_fee_after_tax is the fee actually applied at
      // order-creation time (never recomputed from the branch's *current*
      // fee, or from today's zone fees - see manage-delivery-zone's audit
      // trail for why that distinction matters for historical accuracy).
      supabase
        .from("orders")
        .select("branch_id, status, order_time, delivery_fee_after_tax, order_items(unit_price, quantity)")
        .gte("order_time", startOfDayIso),
    ]);
    const loadedBranches = (branchesRes.data as Branch[]) ?? [];
    setBranches(loadedBranches);
    // load() is called after every unrelated mutation on this page (zone
    // toggle, manager assignment, etc.) - keeping an already-typed, not-yet-
    // saved draft instead of overwriting it stops one action from silently
    // erasing what staff is mid-typing in a different field. A draft is
    // only reset to the server value the first time an id is seen.
    setFeeDrafts((prev) => Object.fromEntries(loadedBranches.map((b) => [b.id, prev[b.id] ?? String(b.delivery_fee)])));
    setRegions((regionsRes.data as Region[]) ?? []);
    setStaff((staffRes.data as StaffUser[]) ?? []);
    const loadedZones = (zonesRes.data as DeliveryZone[]) ?? [];
    setZones(loadedZones);
    setZoneFeeDrafts((prev) => Object.fromEntries(loadedZones.map((z) => [z.id, prev[z.id] ?? String(z.delivery_fee)])));
    setTodaysOrders((ordersRes.data as OrderStatRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const regionName = useMemo(() => {
    const map = new Map(regions.map((r) => [r.id, r.name]));
    return (id: number | null) => (id ? map.get(id) ?? `منطقة #${id}` : "-");
  }, [regions]);

  // Today/pending/completed per branch, computed live from real order rows
  // (todaysOrders, already scoped to today's order_time by the query
  // itself) - pending + completed + failed always sum to the branch's
  // total for today.
  const orderStatsByBranch = useMemo(() => {
    const map = new Map<number, { total: number; pending: number; completed: number; failed: number }>();
    for (const o of todaysOrders) {
      const entry = map.get(o.branch_id) ?? { total: 0, pending: 0, completed: 0, failed: 0 };
      entry.total += 1;
      if (o.status === TERMINAL_SUCCESS) entry.completed += 1;
      else if (TERMINAL_FAILURE.includes(o.status)) entry.failed += 1;
      else entry.pending += 1;
      map.set(o.branch_id, entry);
    }
    return map;
  }, [todaysOrders]);

  // Company-wide "ملخص اليوم" - scoped to whatever orders/branches RLS
  // already let this caller see (only general_manager reaches this tab
  // today, so in practice this is every branch; the same todaysOrders rows
  // that power the per-branch table above, just aggregated the other way).
  // Sales/delivery-revenue deliberately exclude cancelled/rejected orders -
  // no money was actually earned on those. delivery revenue is summed from
  // each order's own stored delivery_fee_after_tax (the fee that was
  // actually applied when that order was placed), never recomputed from
  // today's branch.delivery_fee - a branch's fee can change after the
  // order was created, and the applied amount must stay historically
  // accurate (see update-branch-delivery-fee's audit trail).
  const todaysSummary = useMemo(() => {
    const byStatus = new Map<string, number>();
    let sales = 0;
    let deliveryRevenue = 0;
    for (const o of todaysOrders) {
      byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
      if (!TERMINAL_FAILURE.includes(o.status)) {
        sales += (o.order_items ?? []).reduce((sum, it) => sum + it.unit_price * it.quantity, 0);
        deliveryRevenue += Number(o.delivery_fee_after_tax ?? 0);
      }
    }
    return {
      total: todaysOrders.length,
      byStatus,
      pending: byStatus.get("pending_acceptance") ?? 0,
      preparing: byStatus.get("preparing") ?? 0,
      ready: byStatus.get("ready_for_driver") ?? 0,
      outForDelivery: byStatus.get("out_for_delivery") ?? 0,
      delayed: byStatus.get("delayed") ?? 0,
      completed: byStatus.get(TERMINAL_SUCCESS) ?? 0,
      cancelled: TERMINAL_FAILURE.reduce((sum, s) => sum + (byStatus.get(s) ?? 0), 0),
      sales,
      deliveryRevenue,
    };
  }, [todaysOrders]);

  const statusChartData = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        status,
        label: STATUS_LABELS[status],
        count: todaysSummary.byStatus.get(status) ?? 0,
      })).filter((d) => d.count > 0),
    [todaysSummary],
  );

  const zonesByBranch = useMemo(() => {
    const map = new Map<number, DeliveryZone[]>();
    for (const z of zones) {
      const list = map.get(z.branch_id) ?? [];
      list.push(z);
      map.set(z.branch_id, list);
    }
    return map;
  }, [zones]);

  const branchManagerOf = useMemo(() => {
    const map = new Map<number, StaffUser>();
    for (const u of staff) {
      if (u.role === "branch_manager" && u.branch_id != null) {
        map.set(u.branch_id, u);
      }
    }
    return map;
  }, [staff]);

  const regionManagerOf = useMemo(() => {
    const map = new Map<number, StaffUser>();
    for (const u of staff) {
      if (u.role === "regional_manager" && u.region_id != null) {
        map.set(u.region_id, u);
      }
    }
    return map;
  }, [staff]);

  async function addBranch() {
    setError(null);
    if (!newBranchName.trim()) return setError("اسم الفرع مطلوب");
    const { error: insertError } = await supabase
      .from("branches")
      .insert({ name: newBranchName.trim(), region_id: newBranchRegion || null, is_delivery_available: true });
    if (insertError) return setError(insertError.message);
    setNewBranchName("");
    setNewBranchRegion("");
    load();
  }

  async function addRegion() {
    setError(null);
    if (!newRegionName.trim()) return setError("اسم المنطقة مطلوب");
    const { error: insertError } = await supabase.from("regions").insert({ name: newRegionName.trim() });
    if (insertError) return setError(insertError.message);
    setNewRegionName("");
    load();
  }

  async function toggleDelivery(branch: Branch) {
    setBusyKey(`delivery-${branch.id}`);
    setError(null);
    const { error: updateError } = await supabase
      .from("branches")
      .update({ is_delivery_available: !branch.is_delivery_available })
      .eq("id", branch.id);
    setBusyKey(null);
    if (updateError) return setError(updateError.message);
    load();
  }

  async function saveFee(branch: Branch) {
    setError(null);
    const value = Number(feeDrafts[branch.id]);
    if (Number.isNaN(value) || value < 0) return setError("رسم التوصيل لازم يكون رقم صحيح 0 أو أكبر");
    setBusyKey(`fee-${branch.id}`);
    try {
      // Goes through an edge function (not a direct client update) so the
      // change gets an audit_log row (BRANCH_DELIVERY_FEE_CHANGED) - RLS
      // still independently enforces general_manager-only on the table
      // itself, this is the audit trail on top of that, not a replacement
      // for it.
      await callFunction("update-branch-delivery-fee", { branch_id: branch.id, delivery_fee: value });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحديث رسم التوصيل");
    } finally {
      setBusyKey(null);
    }
  }

  async function addZone(branchId: number) {
    setError(null);
    const draft = newZoneDrafts[branchId] ?? { name: "", fee: "" };
    const name = draft.name.trim();
    const fee = Number(draft.fee);
    if (!name) return setError("اسم المنطقة مطلوب");
    if (Number.isNaN(fee) || fee < 0) return setError("رسم المنطقة لازم يكون رقم صحيح 0 أو أكبر");
    setBusyKey(`zone-add-${branchId}`);
    try {
      await callFunction("manage-delivery-zone", { action: "create", branch_id: branchId, zone_name: name, delivery_fee: fee });
      setNewZoneDrafts({ ...newZoneDrafts, [branchId]: { name: "", fee: "" } });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إضافة المنطقة");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveZoneFee(zone: DeliveryZone) {
    setError(null);
    const value = Number(zoneFeeDrafts[zone.id]);
    if (Number.isNaN(value) || value < 0) return setError("رسم المنطقة لازم يكون رقم صحيح 0 أو أكبر");
    setBusyKey(`zone-fee-${zone.id}`);
    try {
      await callFunction("manage-delivery-zone", { action: "update", zone_id: zone.id, delivery_fee: value });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحديث رسم المنطقة");
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleZoneActive(zone: DeliveryZone) {
    setBusyKey(`zone-toggle-${zone.id}`);
    setError(null);
    try {
      await callFunction("manage-delivery-zone", { action: "toggle_active", zone_id: zone.id, is_active: !zone.is_active });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحديث حالة المنطقة");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteZone(zone: DeliveryZone) {
    if (!confirm(`متأكد إنك عايز تمسح "${zone.zone_name}"؟`)) return;
    setBusyKey(`zone-delete-${zone.id}`);
    setError(null);
    setInfo(null);
    try {
      const res = await callFunction<{ deleted: boolean; soft_deleted: boolean }>("manage-delivery-zone", {
        action: "delete",
        zone_id: zone.id,
      });
      if (res.soft_deleted) {
        setInfo(`"${zone.zone_name}" اتطلبت قبل كده في عناوين/أوردرات حقيقية - مينفعش تتمسح نهائي، فاتقفلت بدل ما تتمسح.`);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل مسح المنطقة");
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadBranchPhoto(branch: Branch, file: File) {
    setError(null);
    setUploadingPhotoId(branch.id);
    try {
      // Uploaded server-side (upload-image edge function) - the server
      // checks the actual file bytes against real image signatures rather
      // than trusting this File object's declared/guessed type, see the
      // function's own comment for why that distinction matters.
      const formData = new FormData();
      formData.append("bucket", "branch-images");
      formData.append("entity_id", String(branch.id));
      formData.append("file", file);
      const { url } = await callFunction<{ url: string }>("upload-image", formData);
      const { error: updateError } = await supabase.from("branches").update({ photo_url: url }).eq("id", branch.id);
      if (updateError) throw new Error(updateError.message);
      setBranches((prev) => prev.map((b) => (b.id === branch.id ? { ...b, photo_url: url } : b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل رفع الصورة");
    } finally {
      setUploadingPhotoId(null);
    }
  }

  async function assignBranchManager(branchId: number) {
    const userId = pickBranchManager[branchId];
    if (!userId) return;
    setBusyKey(`branch-${branchId}`);
    setError(null);
    setInfo(null);
    try {
      const res = await callFunction<{ displaced_user: { name: string } | null }>("assign-manager", {
        user_id: userId,
        target_type: "branch",
        target_id: branchId,
      });
      setInfo(
        res.displaced_user
          ? `تم التعيين - "${res.displaced_user.name}" بقى من غير فرع دلوقتي.`
          : "تم التعيين بنجاح.",
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التعيين");
    } finally {
      setBusyKey(null);
    }
  }

  async function assignRegionManager(regionId: number) {
    const userId = pickRegionManager[regionId];
    if (!userId) return;
    setBusyKey(`region-${regionId}`);
    setError(null);
    setInfo(null);
    try {
      const res = await callFunction<{ displaced_user: { name: string } | null }>("assign-manager", {
        user_id: userId,
        target_type: "region",
        target_id: regionId,
      });
      setInfo(
        res.displaced_user
          ? `تم التعيين - "${res.displaced_user.name}" بقى من غير منطقة دلوقتي.`
          : "تم التعيين بنجاح.",
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التعيين");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      {error && <p className="error-text">{error}</p>}
      {info && (
        <div className="card success-banner">
          <p>{info}</p>
        </div>
      )}

      <div className="card">
        <h2>ملخص اليوم</h2>
        <div className="stat-row">
          <div className="stat-tile">
            <span className="stat-value">{todaysSummary.total}</span>
            <span className="stat-label">إجمالي الطلبات اليوم</span>
          </div>
          <div className="stat-tile stat-tile-success">
            <span className="stat-value">{todaysSummary.sales.toLocaleString("ar-EG")} ج.م</span>
            <span className="stat-label">إجمالي المبيعات اليوم</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{todaysSummary.deliveryRevenue.toLocaleString("ar-EG")} ج.م</span>
            <span className="stat-label">إجمالي رسوم التوصيل اليوم</span>
          </div>
        </div>

        <div className="status-pill-row">
          <span className="status-pill">قيد الانتظار: {todaysSummary.pending}</span>
          <span className="status-pill">قيد التنفيذ: {todaysSummary.preparing}</span>
          <span className="status-pill">جاهز: {todaysSummary.ready}</span>
          <span className="status-pill">قيد التوصيل: {todaysSummary.outForDelivery}</span>
          <span className={`status-pill${todaysSummary.delayed > 0 ? " status-pill-danger" : ""}`}>
            متأخر: {todaysSummary.delayed}
          </span>
          <span className="status-pill status-pill-success">مكتمل: {todaysSummary.completed}</span>
          <span className="status-pill status-pill-muted">ملغي/مرفوض: {todaysSummary.cancelled}</span>
        </div>

        {statusChartData.length > 0 && (
          <div className="chart-wrap" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChartData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fontFamily: "Cairo" }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={80}
                  tick={{ fontSize: 12, fontFamily: "Cairo" }}
                  orientation="right"
                />
                <Tooltip contentStyle={{ fontFamily: "Cairo", direction: "rtl" }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {statusChartData.map((d) => (
                    <Cell key={d.status} fill={CHART_COLORS[STATUS_ORDER.indexOf(d.status as (typeof STATUS_ORDER)[number]) % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <h2>إضافة منطقة</h2>
        <div className="inline-row">
          <input placeholder="اسم المنطقة" value={newRegionName} onChange={(e) => setNewRegionName(e.target.value)} />
          <button className="btn-primary" onClick={addRegion}>
            إضافة
          </button>
        </div>
      </div>

      <div className="card">
        <h2>إضافة فرع</h2>
        <div className="inline-row">
          <input placeholder="اسم الفرع" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} />
          <select value={newBranchRegion} onChange={(e) => setNewBranchRegion(e.target.value ? Number(e.target.value) : "")}>
            <option value="">بدون منطقة</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={addBranch}>
            إضافة
          </button>
        </div>
      </div>

      <div className="card">
        <h2>المناطق ({regions.length})</h2>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>المنطقة</th>
                <th>مدير المنطقة</th>
                <th>تعيين مدير</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => {
                const manager = regionManagerOf.get(r.id);
                return (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className={manager ? undefined : "muted"}>{manager ? manager.name : "مفيش مدير معيّن"}</td>
                    <td>
                      <div className="actions-cell">
                        <select
                          value={pickRegionManager[r.id] ?? ""}
                          onChange={(e) => setPickRegionManager({ ...pickRegionManager, [r.id]: e.target.value })}
                        >
                          <option value="">-- اختر موظف --</option>
                          {staff.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.phone})
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-sm btn-primary"
                          disabled={busyKey === `region-${r.id}` || !pickRegionManager[r.id]}
                          onClick={() => assignRegionManager(r.id)}
                        >
                          تعيين
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>الفروع ({branches.length})</h2>
        <p className="muted" style={{ marginTop: "-8px" }}>
          "حالة التوصيل" مبنية على إعداد "متاح للتوصيل" الحقيقي لكل فرع - بتقول هل الفرع بيقبل أوردرات توصيل دلوقتي
          أم استلام من الفرع بس، مش نوع خدمة الفرع (صالة/تيك أواي) لأن ده مش متتبّع في النظام حاليًا. مفيش جدول
          مواعيد منفصل لكل فرع - مواعيد العمل حاليًا إعداد واحد للشركة كلها، شاشة "مواعيد العمل". رسوم التوصيل
          الحقيقية بتتحدد على مستوى المنطقة جوه كل فرع مش رقم واحد ثابت - افتح "إدارة" لأي فرع علشان تدير مناطقه.
        </p>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الفرع</th>
                <th>حالة التوصيل</th>
                <th>أوردرات النهاردة</th>
                <th>قيد التنفيذ</th>
                <th>مكتملة</th>
                <th>مناطق التوصيل</th>
                <th>الموقع</th>
                <th>إدارة</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const manager = branchManagerOf.get(b.id);
                const stats = orderStatsByBranch.get(b.id) ?? { total: 0, pending: 0, completed: 0, failed: 0 };
                const isExpanded = expandedBranchId === b.id;
                const branchZones = zonesByBranch.get(b.id) ?? [];
                const activeZoneCount = branchZones.filter((z) => z.is_active).length;
                return (
                  <Fragment key={b.id}>
                    <tr>
                      <td>{b.name}</td>
                      <td>
                        <span className={b.is_delivery_available ? "badge-active" : "badge-inactive"}>
                          {b.is_delivery_available ? "🟢 التوصيل متاح" : "🔴 استلام من الفرع بس"}
                        </span>
                      </td>
                      <td className="num-cell">{stats.total}</td>
                      <td className="num-cell">{stats.pending}</td>
                      <td className="num-cell">{stats.completed}</td>
                      <td className="num-cell">{activeZoneCount} منطقة{branchZones.length > activeZoneCount ? ` (+${branchZones.length - activeZoneCount} متوقفة)` : ""}</td>
                      <td>
                        {b.address ? (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}`}
                            target="_blank"
                            rel="noreferrer"
                            title={b.address}
                          >
                            📍
                          </a>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        <button className="btn-sm btn-link" onClick={() => setExpandedBranchId(isExpanded ? null : b.id)}>
                          {isExpanded ? "إخفاء" : "إدارة"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8}>
                          <div className="card" style={{ margin: 0 }}>
                            <div className="actions-cell" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "var(--space-4)" }}>
                              <div>
                                <p className="muted" style={{ margin: "0 0 6px" }}>صورة الفرع</p>
                                <div className="actions-cell">
                                  {b.photo_url ? (
                                    <img
                                      src={b.photo_url}
                                      alt={b.name}
                                      style={{ width: "90px", height: "60px", objectFit: "cover", borderRadius: "6px" }}
                                    />
                                  ) : (
                                    <span className="muted">مفيش صورة</span>
                                  )}
                                  <label className="btn-sm btn-primary" style={{ cursor: "pointer" }}>
                                    {uploadingPhotoId === b.id ? "جاري الرفع..." : b.photo_url ? "تغيير" : "رفع صورة"}
                                    <input
                                      type="file"
                                      accept="image/*"
                                      style={{ display: "none" }}
                                      disabled={uploadingPhotoId === b.id}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) uploadBranchPhoto(b, file);
                                        e.target.value = "";
                                      }}
                                    />
                                  </label>
                                </div>
                              </div>

                              <div>
                                <p className="muted" style={{ margin: "0 0 6px" }}>المنطقة</p>
                                <p>{regionName(b.region_id)}</p>
                              </div>

                              <div>
                                <p className="muted" style={{ margin: "0 0 6px" }}>مدير الفرع</p>
                                <p className={manager ? undefined : "muted"}>{manager ? manager.name : "مفيش مدير معيّن"}</p>
                                <div className="actions-cell">
                                  <select
                                    value={pickBranchManager[b.id] ?? ""}
                                    onChange={(e) => setPickBranchManager({ ...pickBranchManager, [b.id]: e.target.value })}
                                  >
                                    <option value="">-- اختر موظف --</option>
                                    {staff.map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.name} ({u.phone})
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    className="btn-sm btn-primary"
                                    disabled={busyKey === `branch-${b.id}` || !pickBranchManager[b.id]}
                                    onClick={() => assignBranchManager(b.id)}
                                  >
                                    تعيين
                                  </button>
                                </div>
                              </div>

                              <div>
                                <p className="muted" style={{ margin: "0 0 6px" }}>متاح للتوصيل</p>
                                <input
                                  type="checkbox"
                                  checked={b.is_delivery_available}
                                  disabled={busyKey === `delivery-${b.id}`}
                                  onChange={() => toggleDelivery(b)}
                                />
                              </div>

                              <div>
                                <p className="muted" style={{ margin: "0 0 6px" }}>
                                  رسم التوصيل الافتراضي
                                  <br />
                                  (لو العنوان مفيهوش منطقة محددة)
                                </p>
                                <div className="actions-cell">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    style={{ width: "70px" }}
                                    value={feeDrafts[b.id] ?? ""}
                                    onChange={(e) => setFeeDrafts({ ...feeDrafts, [b.id]: e.target.value })}
                                  />
                                  <button
                                    className="btn-sm btn-primary"
                                    disabled={busyKey === `fee-${b.id}` || feeDrafts[b.id] === String(b.delivery_fee)}
                                    onClick={() => saveFee(b)}
                                  >
                                    حفظ
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
                              <p className="muted" style={{ margin: "0 0 8px" }}>
                                مناطق التوصيل ({branchZones.length})
                              </p>
                              {branchZones.length === 0 && <p className="muted">مفيش مناطق مضافة للفرع ده لسه.</p>}
                              {branchZones.map((z) => (
                                <div
                                  key={z.id}
                                  className="actions-cell"
                                  style={{ alignItems: "center", marginBottom: 6, opacity: z.is_active ? 1 : 0.55 }}
                                >
                                  <span style={{ minWidth: "140px" }}>
                                    {z.zone_name}
                                    {!z.is_active && <span className="muted"> (متوقفة)</span>}
                                  </span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    style={{ width: "70px" }}
                                    value={zoneFeeDrafts[z.id] ?? ""}
                                    onChange={(e) => setZoneFeeDrafts({ ...zoneFeeDrafts, [z.id]: e.target.value })}
                                  />
                                  <button
                                    className="btn-sm btn-primary"
                                    disabled={busyKey === `zone-fee-${z.id}` || zoneFeeDrafts[z.id] === String(z.delivery_fee)}
                                    onClick={() => saveZoneFee(z)}
                                  >
                                    حفظ
                                  </button>
                                  <button
                                    className="btn-sm btn-link"
                                    disabled={busyKey === `zone-toggle-${z.id}`}
                                    onClick={() => toggleZoneActive(z)}
                                  >
                                    {z.is_active ? "إيقاف" : "تفعيل"}
                                  </button>
                                  <button
                                    className="btn-sm btn-link"
                                    style={{ color: "var(--danger)" }}
                                    disabled={busyKey === `zone-delete-${z.id}`}
                                    onClick={() => deleteZone(z)}
                                  >
                                    حذف
                                  </button>
                                </div>
                              ))}
                              <div className="actions-cell" style={{ marginTop: 8 }}>
                                <input
                                  placeholder="اسم منطقة جديدة"
                                  style={{ width: "160px" }}
                                  value={newZoneDrafts[b.id]?.name ?? ""}
                                  onChange={(e) =>
                                    setNewZoneDrafts({
                                      ...newZoneDrafts,
                                      [b.id]: { name: e.target.value, fee: newZoneDrafts[b.id]?.fee ?? "" },
                                    })
                                  }
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  placeholder="الرسم"
                                  style={{ width: "80px" }}
                                  value={newZoneDrafts[b.id]?.fee ?? ""}
                                  onChange={(e) =>
                                    setNewZoneDrafts({
                                      ...newZoneDrafts,
                                      [b.id]: { name: newZoneDrafts[b.id]?.name ?? "", fee: e.target.value },
                                    })
                                  }
                                />
                                <button
                                  className="btn-sm btn-primary"
                                  disabled={busyKey === `zone-add-${b.id}`}
                                  onClick={() => addZone(b.id)}
                                >
                                  + إضافة منطقة
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
