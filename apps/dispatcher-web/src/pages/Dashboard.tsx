import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";
import { CHART_COLORS } from "../lib/chartColors";
import { playNewOrderChime, playCancellationAlert } from "../lib/alertSound";
import { downloadCsv } from "../lib/csv";

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
  order_source: string;
  accepted_by: string | null;
  accepted_at: string | null;
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

const ROLE_LABELS_AR: Record<string, string> = {
  team_leader: "تيم ليدر",
  general_manager: "مدير عام",
};

interface StaffLite {
  id: string;
  name: string;
  role: string;
  branch_id: number | null;
}

const ONGOING_STATUSES = ["preparing", "out_for_delivery", "delayed"];

// profile isn't used for client-side scoping anymore - branch_manager/
// regional_manager retired (2026-08-21), and general_manager/team_leader
// (the only roles that ever reach this screen, see TABS_BY_ROLE) both see
// everything RLS already lets them see, unscoped. Kept in the signature
// only so this screen matches every other tab's ScreenFor(tab, profile)
// call shape.
export function Dashboard({ profile: _profile }: { profile: Profile }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [drivers, setDrivers] = useState<DriverLite[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusBranchId, setFocusBranchId] = useState<number | "all">("all");
  // Call-center orders happen over the phone, off-screen for a general_
  // manager/team_leader who's only looking at this dashboard - unlike
  // Dispatch.tsx/AcceptanceLobby.tsx there's no natural "open it to
  // acknowledge" action here, so this is a one-shot chime + dismissible
  // list per arrival rather than a repeating alarm nobody can silence.
  const [newCallCenterOrders, setNewCallCenterOrders] = useState<OrderRow[]>([]);
  const [newlyCancelledOrders, setNewlyCancelledOrders] = useState<OrderRow[]>([]);
  // Tracks each known order's last-seen status, not just its id - a plain
  // id set can tell "new" from "known", but catching a cancellation needs
  // to know what the order's status *was* the previous time around.
  const knownStatusById = useRef<Map<number, string> | null>(null);

  async function load() {
    // Finding #003 (security audit): this used to fetch every order ever
    // placed, unbounded, forever. Everything this screen actually shows
    // is either a currently-ongoing order (regardless of age - status
    // alone decides that) or something from the last 7 days (today's
    // delivered count/chart, and catching a fresh cancellation) - a
    // terminal order (delivered/cancelled/rejected) older than that was
    // already irrelevant to every number on this page, it was just
    // being fetched and thrown away.
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [ordersRes, branchesRes, driversRes, staffRes] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, pos_order_id, status, branch_id, driver_id, order_time, dispatch_time, delivered_time, sla_minutes, delay_minutes, is_delayed, payment_method, order_source, accepted_by, accepted_at",
        )
        .or(`status.in.(preparing,out_for_delivery,delayed),order_time.gte.${sevenDaysAgoIso}`),
      supabase.from("branches").select("id, name, region_id"),
      supabase.from("users").select("id, name").eq("role", "driver"),
      // accept-order only ever lets team_leader/general_manager accept -
      // this is the whole pool "قبل بواسطة" could ever resolve to.
      supabase.from("users").select("id, name, role, branch_id").in("role", ["team_leader", "general_manager"]),
    ]);
    const freshOrders = (ordersRes.data as OrderRow[]) ?? [];

    if (knownStatusById.current) {
      const previous = knownStatusById.current;
      const newlyArrivedCallCenter = freshOrders.filter(
        (o) => !previous.has(o.id) && o.order_source === "call_center",
      );
      const newlyCancelled = freshOrders.filter(
        (o) => previous.has(o.id) && previous.get(o.id) !== "cancelled" && o.status === "cancelled",
      );
      if (newlyArrivedCallCenter.length > 0) {
        playNewOrderChime();
        setNewCallCenterOrders((prev) => [...newlyArrivedCallCenter, ...prev]);
      }
      if (newlyCancelled.length > 0) {
        playCancellationAlert();
        setNewlyCancelledOrders((prev) => [...newlyCancelled, ...prev]);
      }
    }
    knownStatusById.current = new Map(freshOrders.map((o) => [o.id, o.status]));

    setOrders(freshOrders);
    setBranches((branchesRes.data as Branch[]) ?? []);
    setDrivers((driversRes.data as DriverLite[]) ?? []);
    setStaff((staffRes.data as StaffLite[]) ?? []);
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

  function dismissCallCenterAlert(orderId: number) {
    setNewCallCenterOrders((prev) => prev.filter((o) => o.id !== orderId));
  }

  function dismissCancelledAlert(orderId: number) {
    setNewlyCancelledOrders((prev) => prev.filter((o) => o.id !== orderId));
  }

  // branch_manager/regional_manager retired as roles (2026-08-21, Karim's
  // request) - this screen is only ever reached by general_manager/
  // team_leader now (see TABS_BY_ROLE), neither of which is branch- or
  // region-scoped, so every branch RLS already lets them see is a valid
  // focus option.
  const scopedBranches = branches;

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
    const staffById = new Map(staff.map((s) => [s.id, s]));
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
      "قبل بواسطة",
      "وظيفة اللي قبل",
      "فرع اللي قبل",
      "وقت القبول",
    ];
    const rows = todaysOrders.map((o) => {
      const acceptor = o.accepted_by ? staffById.get(o.accepted_by) : undefined;
      return [
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
        acceptor?.name ?? "",
        acceptor ? ROLE_LABELS_AR[acceptor.role] ?? acceptor.role : "",
        acceptor?.branch_id ? branchName.get(acceptor.branch_id) ?? "" : "",
        o.accepted_at ?? "",
      ];
    });

    const todayLabel = new Date().toISOString().slice(0, 10);
    downloadCsv(`تقرير-يومي-${todayLabel}.csv`, [header, ...rows]);
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      {newCallCenterOrders.length > 0 && (
        <div className="card" style={{ borderColor: "var(--color-tomato)" }}>
          <h2 style={{ margin: "0 0 8px" }}>أوردرات جديدة من الكول سنتر</h2>
          {newCallCenterOrders.map((o) => (
            <div key={o.id} className="stat-row" style={{ alignItems: "center", marginBottom: 6 }}>
              <span>أوردر #{o.pos_order_id ?? o.id}</span>
              <button className="btn-link" onClick={() => dismissCallCenterAlert(o.id)}>
                تمام
              </button>
            </div>
          ))}
        </div>
      )}

      {newlyCancelledOrders.length > 0 && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <h2 style={{ margin: "0 0 8px" }}>أوردر اتلغى</h2>
          {newlyCancelledOrders.map((o) => (
            <div key={o.id} className="stat-row" style={{ alignItems: "center", marginBottom: 6 }}>
              <span>أوردر #{o.pos_order_id ?? o.id}</span>
              <button className="btn-link" onClick={() => dismissCancelledAlert(o.id)}>
                تمام
              </button>
            </div>
          ))}
        </div>
      )}

      {scopedBranches.length > 1 && (
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
