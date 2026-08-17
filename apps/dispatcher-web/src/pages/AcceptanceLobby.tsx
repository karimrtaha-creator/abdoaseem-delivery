import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { playNewOrderChime, playCancellationAlert } from "../lib/alertSound";

// How often the "new pending order" alarm repeats while anything is still
// waiting - matches Dispatch.tsx's own CHIME_REPEAT_MS.
const CHIME_REPEAT_MS = 4000;

interface Branch {
  id: number;
  name: string;
}

interface PendingOrder {
  id: number;
  branch_id: number;
  customer_phone: string;
  order_source: string;
  order_time: string;
  payment_method: "cash" | "instapay_transfer";
  payment_proof_url: string | null;
}

interface OngoingOrder {
  id: number;
  branch_id: number;
  status: string;
  customer_phone: string;
}

interface OrderItemRow {
  id: number;
  order_id: number;
  quantity: number;
  combo_selection: string | null;
  note: string | null;
  menu_items: { name: string } | null;
  combo_offers: { name: string } | null;
}

const STAFF_CANCELLABLE_STATUSES = ["preparing", "out_for_delivery", "delayed"];

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

const STATUS_LABELS: Record<string, string> = {
  preparing: "جاري التحضير",
  out_for_delivery: "طريقه للتوصيل",
  delayed: "متأخر",
};

export function AcceptanceLobby() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [ongoingOrders, setOngoingOrders] = useState<OngoingOrder[]>([]);
  const [acceptedTodayByBranch, setAcceptedTodayByBranch] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [proofUrls, setProofUrls] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [orderItemsByOrder, setOrderItemsByOrder] = useState<Map<number, OrderItemRow[]>>(new Map());
  const [cancelOpenFor, setCancelOpenFor] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  // Which pending-acceptance orders we already knew about, so a fresh
  // load() can tell "still waiting" apart from "just disappeared" - and,
  // for the ones that disappeared, whether that was an accept/reject or
  // the customer cancelling it themselves (see the follow-up status check
  // in loadAll below).
  const knownPendingIds = useRef<Set<number> | null>(null);
  const [customerCancelledIds, setCustomerCancelledIds] = useState<number[]>([]);
  // loadAll() is triggered from three uncoordinated sources (mount, a
  // company-wide realtime subscription, and every accept/reject/cancel) -
  // with no ordering guarantee between overlapping calls, a slower earlier
  // response could otherwise land after a faster later one and overwrite
  // fresh state with stale state (e.g. an order just accepted here
  // reappearing as pending, or a customer-cancellation alert firing off
  // data that's already superseded).
  const loadSeqRef = useRef(0);

  async function loadAll() {
    const seq = ++loadSeqRef.current;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [branchesRes, pendingRes, ongoingRes, acceptedTodayRes] = await Promise.all([
      supabase.from("branches").select("id, name"),
      supabase
        .from("orders")
        .select("id, branch_id, customer_phone, order_source, order_time, payment_method, payment_proof_url")
        .eq("status", "pending_acceptance")
        .order("order_time", { ascending: true }),
      supabase
        .from("orders")
        .select("id, branch_id, status, customer_phone")
        .in("status", ["preparing", "out_for_delivery", "delayed"])
        .order("id", { ascending: false }),
      supabase
        .from("orders")
        .select("branch_id")
        .gte("accepted_at", startOfDay.toISOString()),
    ]);

    const pending = (pendingRes.data as PendingOrder[]) ?? [];
    const ongoing = (ongoingRes.data as OngoingOrder[]) ?? [];

    // Diff against the previous snapshot: any pending order that vanished
    // without going through accept/reject on *this* client (another staff
    // member, or the customer themselves) needs a status check to tell
    // "got accepted/rejected elsewhere" apart from "customer cancelled it" -
    // only the latter gets its own alert here.
    let cancelledIds: number[] = [];
    if (knownPendingIds.current) {
      const freshIds = new Set(pending.map((o) => o.id));
      const disappeared = [...knownPendingIds.current].filter((id) => !freshIds.has(id));
      if (disappeared.length > 0) {
        const { data: statusRows } = await supabase.from("orders").select("id, status").in("id", disappeared);
        cancelledIds = (statusRows ?? []).filter((r) => r.status === "cancelled").map((r) => r.id);
      }
    }

    // Line items for every order shown on this screen - team_leader used to
    // have to accept/reject and cancel completely blind to what was
    // actually ordered, found during an audit.
    const orderIds = [...pending.map((o) => o.id), ...ongoing.map((o) => o.id)];
    let byOrder = new Map<number, OrderItemRow[]>();
    if (orderIds.length > 0) {
      const { data: itemsData } = await supabase
        .from("order_items")
        .select("id, order_id, quantity, combo_selection, note, menu_items(name), combo_offers(name)")
        .in("order_id", orderIds);
      for (const item of (itemsData as unknown as OrderItemRow[]) ?? []) {
        const list = byOrder.get(item.order_id) ?? [];
        list.push(item);
        byOrder.set(item.order_id, list);
      }
    }

    // A newer loadAll() has since started - discard this one entirely
    // rather than let its now-stale results overwrite fresher state.
    if (loadSeqRef.current !== seq) return;

    if (cancelledIds.length > 0) {
      playCancellationAlert();
      setCustomerCancelledIds((prev) => [...cancelledIds, ...prev]);
    }
    knownPendingIds.current = new Set(pending.map((o) => o.id));

    setBranches((branchesRes.data as Branch[]) ?? []);
    setPendingOrders(pending);
    setOngoingOrders(ongoing);

    const counts = new Map<number, number>();
    for (const row of (acceptedTodayRes.data as { branch_id: number }[]) ?? []) {
      counts.set(row.branch_id, (counts.get(row.branch_id) ?? 0) + 1);
    }
    setAcceptedTodayByBranch(counts);
    setOrderItemsByOrder(byOrder);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    const channel = supabase
      .channel("acceptance-lobby-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: number) => map.get(id) ?? `فرع #${id}`;
  }, [branches]);

  // "Agent" (call_center role, 2026-08-11) sees this screen too now, for
  // website orders only - narrowed further the same night (migration
  // 0044) to drop phone-order visibility entirely, so RLS itself now
  // guarantees `pendingOrders`/`ongoingOrders` never contain a
  // call_center-sourced row for this role - no client-side filtering
  // needed here anymore, the backend already only ever returns what
  // they're meant to see.
  const visiblePendingOrders = pendingOrders;

  // Repeats for as long as anything is still waiting - never a one-shot
  // ping, exactly per the ask: it doesn't stop until every pending order
  // has actually been accepted or rejected.
  const hasPending = visiblePendingOrders.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    playNewOrderChime();
    const timer = setInterval(playNewOrderChime, CHIME_REPEAT_MS);
    return () => clearInterval(timer);
  }, [hasPending]);

  function dismissCancelledAlert(orderId: number) {
    setCustomerCancelledIds((prev) => prev.filter((id) => id !== orderId));
  }

  async function loadProofUrl(order: PendingOrder) {
    if (!order.payment_proof_url || proofUrls.has(order.id)) return;
    const { data } = await supabase.storage
      .from("payment-proofs")
      .createSignedUrl(order.payment_proof_url, 300);
    if (data?.signedUrl) {
      setProofUrls((prev) => new Map(prev).set(order.id, data.signedUrl));
    }
  }

  async function decide(orderId: number, action: "accept" | "reject") {
    setBusyOrderId(orderId);
    setError(null);
    try {
      await callFunction("accept-order", { order_id: orderId, action });
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حصل خطأ");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function cancelOngoingOrder(orderId: number) {
    if (!cancelReason.trim()) return;
    setBusyOrderId(orderId);
    setError(null);
    try {
      await callFunction("cancel-order", { order_id: orderId, reason: cancelReason.trim() });
      setCancelOpenFor(null);
      setCancelReason("");
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إلغاء الأوردر");
    } finally {
      setBusyOrderId(null);
    }
  }

  function OrderItemsList({ orderId }: { orderId: number }) {
    const items = orderItemsByOrder.get(orderId) ?? [];
    if (items.length === 0) return null;
    return (
      <div style={{ margin: "8px 0" }}>
        {items.map((line) => (
          <div key={line.id} style={{ fontSize: "0.9rem", marginBottom: 4 }}>
            <span>
              {line.menu_items?.name ?? line.combo_offers?.name ?? "صنف"} × {line.quantity}
            </span>
            {line.combo_selection && <span className="muted"> - {line.combo_selection}</span>}
            {line.note && <p className="error-text" style={{ margin: "2px 0 0" }}>ملاحظة العميل: {line.note}</p>}
          </div>
        ))}
      </div>
    );
  }

  const totalAcceptedToday = [...acceptedTodayByBranch.values()].reduce((a, b) => a + b, 0);

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      {customerCancelledIds.length > 0 && (
        <div className="card" style={{ borderColor: "var(--color-tomato)" }}>
          <h2 style={{ margin: "0 0 8px" }}>العميل لغى الأوردر بنفسه</h2>
          {customerCancelledIds.map((id) => (
            <div key={id} className="stat-row" style={{ alignItems: "center", marginBottom: 6 }}>
              <span>أوردر #{id}</span>
              <button className="btn-link" onClick={() => dismissCancelledAlert(id)}>
                تمام
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>ملخص اليوم</h2>
        <div className="stat-row">
          <div className="stat-tile">
            <span className="stat-value">{totalAcceptedToday}</span>
            <span className="stat-label">إجمالي الأوردرات المقبولة النهاردة</span>
          </div>
        </div>
        <div className="data-table-wrap" style={{ marginTop: "var(--space-3)" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>الفرع</th>
                <th>المقبولة النهاردة</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="num-cell">{acceptedTodayByBranch.get(b.id) ?? 0}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>الإجمالي</td>
                <td className="num-cell">{totalAcceptedToday}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>بانتظار القبول ({visiblePendingOrders.length})</h2>
        {error && <p className="error-text">{error}</p>}
        {visiblePendingOrders.length === 0 && <p className="muted">مفيش أوردرات بانتظار القبول.</p>}
        <div className="order-list">
          {visiblePendingOrders.map((o) => (
            <div key={o.id} className="card pending-order-card">
              <div className="pending-order-header">
                <strong>أوردر #{o.id}</strong>
                <span className="muted">{branchName(o.branch_id)}</span>
              </div>
              <p className="muted">
                {o.customer_phone} - {new Date(o.order_time).toLocaleTimeString("ar-EG")} -{" "}
                {o.payment_method === "cash" ? "كاش" : "تحويل انستاباي"}
              </p>
              {o.payment_method === "instapay_transfer" && (
                <div>
                  {proofUrls.has(o.id) ? (
                    <img src={proofUrls.get(o.id)} alt="إثبات التحويل" className="payment-proof-img" />
                  ) : (
                    <button className="btn-link" onClick={() => loadProofUrl(o)}>
                      عرض صورة إثبات التحويل
                    </button>
                  )}
                </div>
              )}
              <OrderItemsList orderId={o.id} />
              <div className="inline-row">
                <button
                  className="btn-primary"
                  disabled={busyOrderId === o.id}
                  onClick={() => decide(o.id, "accept")}
                >
                  قبول
                </button>
                <button
                  className="btn-danger"
                  disabled={busyOrderId === o.id}
                  onClick={() => decide(o.id, "reject")}
                >
                  رفض
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>الأوردرات الجارية ({ongoingOrders.length})</h2>
        <div className="order-list">
          {ongoingOrders.map((o) => (
            <div key={o.id} className={`card pending-order-card${o.status === "delayed" ? " order-row-delayed" : ""}`}>
              <div className="pending-order-header">
                <strong>أوردر #{o.id}</strong>
                <span className="muted">
                  {branchName(o.branch_id)} - {STATUS_LABELS[o.status] ?? o.status}
                </span>
              </div>
              <OrderItemsList orderId={o.id} />
              {STAFF_CANCELLABLE_STATUSES.includes(o.status) && (
                <>
                  {cancelOpenFor === o.id ? (
                    <div className="inline-row" style={{ marginTop: 6 }}>
                      <input
                        placeholder="سبب الإلغاء (إجباري)"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                      <button
                        className="btn-danger"
                        disabled={busyOrderId === o.id || !cancelReason.trim()}
                        onClick={() => cancelOngoingOrder(o.id)}
                      >
                        تأكيد الإلغاء
                      </button>
                      <button
                        className="btn-link"
                        onClick={() => {
                          setCancelOpenFor(null);
                          setCancelReason("");
                        }}
                      >
                        رجوع
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn-link"
                      style={{ color: "var(--danger)" }}
                      onClick={() => {
                        setCancelOpenFor(o.id);
                        setCancelReason("");
                      }}
                    >
                      إلغاء الأوردر
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
