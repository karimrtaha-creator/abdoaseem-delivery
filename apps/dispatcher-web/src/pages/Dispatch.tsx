import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";
import { playNewOrderChime, playPrepDelayAlarm } from "../lib/alertSound";

interface PreparingOrder {
  id: number;
  pos_order_id: string | null;
  customer_phone: string;
  order_time: string;
  accepted_at: string;
}

interface Driver {
  id: string;
  name: string;
}

interface OrderItemRow {
  id: number;
  quantity: number;
  combo_selection: string | null;
  note: string | null;
  menu_items: { name: string } | null;
  combo_offers: { name: string } | null;
}

type Step = "pick_order" | "confirm";

// No prep-time SLA is defined anywhere in the spec (sla_tiers only covers
// dispatch->delivery). This is a starting default for "an order has been
// sitting in preparing too long, someone forgot it" - trivially adjustable,
// not derived from any document value.
const PREP_ALERT_THRESHOLD_MINUTES = 10;

// How often the ringing/alarm loops repeat while there's something
// unacknowledged, and how often the list re-checks for newly-overdue orders.
const CHIME_REPEAT_MS = 4000;
const ALARM_REPEAT_MS = 6000;
const RECHECK_MS = 10000;

function isPastPrepThreshold(order: PreparingOrder): boolean {
  const acceptedAt = new Date(order.accepted_at).getTime();
  return Date.now() - acceptedAt > PREP_ALERT_THRESHOLD_MINUTES * 60_000;
}

export function Dispatch({ profile }: { profile: Profile }) {
  const [orders, setOrders] = useState<PreparingOrder[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("pick_order");
  const [ringingOrderIds, setRingingOrderIds] = useState<Set<number>>(new Set());
  // Value is never read - re-rendering is the only point, so `hasDelayed`
  // below gets recomputed against the current time on a schedule even when
  // nothing in `orders` itself has changed.
  const [, forceRecheck] = useState(0);
  const knownOrderIds = useRef<Set<number> | null>(null);

  const [selectedOrder, setSelectedOrder] = useState<PreparingOrder | null>(null);
  const [selectedOrderItems, setSelectedOrderItems] = useState<OrderItemRow[]>([]);
  const [driverId, setDriverId] = useState("");
  const [fee, setFee] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function loadQueue() {
    const [ordersRes, driversRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, pos_order_id, customer_phone, order_time, accepted_at")
        .eq("branch_id", profile.branch_id)
        .eq("status", "preparing")
        .order("order_time", { ascending: true }),
      supabase
        .from("users")
        .select("id, name")
        .eq("branch_id", profile.branch_id)
        .eq("role", "driver")
        .eq("is_active", true)
        .order("name"),
    ]);
    const freshOrders = (ordersRes.data as PreparingOrder[]) ?? [];
    setDrivers((driversRes.data as Driver[]) ?? []);

    // Diff against the last known snapshot so a genuinely new arrival rings,
    // whether it got here via INSERT or an accept-order UPDATE - independent
    // of what Postgres's replica identity setting does or doesn't include.
    const freshIds = new Set(freshOrders.map((o) => o.id));
    if (knownOrderIds.current) {
      const newlyArrived = freshOrders.filter((o) => !knownOrderIds.current!.has(o.id));
      if (newlyArrived.length > 0) {
        setRingingOrderIds((prev) => {
          const next = new Set(prev);
          newlyArrived.forEach((o) => next.add(o.id));
          return next;
        });
      }
    }
    knownOrderIds.current = freshIds;

    setOrders(freshOrders);
    setLoading(false);
  }

  useEffect(() => {
    loadQueue();
    const channel = supabase
      .channel("dispatcher-preparing-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `branch_id=eq.${profile.branch_id}` },
        () => loadQueue(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.branch_id]);

  // Periodic re-check so "past the prep threshold" catches up even when
  // nothing in the DB has changed.
  useEffect(() => {
    const timer = setInterval(() => forceRecheck((n) => n + 1), RECHECK_MS);
    return () => clearInterval(timer);
  }, []);

  const delayedOrders = orders.filter(isPastPrepThreshold);
  const hasRinging = ringingOrderIds.size > 0;
  const hasDelayed = delayedOrders.length > 0;

  // "New order" chime: repeats until the dispatcher opens that order.
  useEffect(() => {
    if (!hasRinging) return;
    playNewOrderChime();
    const timer = setInterval(playNewOrderChime, CHIME_REPEAT_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRinging]);

  // Prep-delay alarm: distinct tone, repeats while any order is overdue.
  // `tick` is deliberately NOT a dependency here - it only exists to force
  // a re-render so `hasDelayed` gets recomputed against the current time.
  // If it stays true across ticks, this effect must NOT rerun, or the
  // interval below would restart every RECHECK_MS and never get a chance
  // to fire on its own ALARM_REPEAT_MS cadence.
  useEffect(() => {
    if (!hasDelayed) return;
    playPrepDelayAlarm();
    const timer = setInterval(playPrepDelayAlarm, ALARM_REPEAT_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDelayed]);

  function pickOrder(order: PreparingOrder) {
    setSelectedOrder(order);
    setSelectedOrderItems([]);
    setDriverId("");
    setFee("");
    setReceiptFile(null);
    setError(null);
    setResult(null);
    setStep("confirm");
    // The dispatcher/branch has had no way to see what's actually in the
    // order anywhere in this screen until now - found during an audit that
    // per-item customer notes ("من غير تقلية") were being saved but never
    // shown to anyone who could act on them.
    supabase
      .from("order_items")
      .select("id, quantity, combo_selection, note, menu_items(name), combo_offers(name)")
      .eq("order_id", order.id)
      .then(({ data }) => setSelectedOrderItems((data as unknown as OrderItemRow[]) ?? []));
    // Opening the order counts as the dispatcher acknowledging it.
    setRingingOrderIds((prev) => {
      if (!prev.has(order.id)) return prev;
      const next = new Set(prev);
      next.delete(order.id);
      return next;
    });
  }

  async function confirmExit() {
    if (!selectedOrder || !driverId || !fee || !receiptFile) {
      setError("لازم تختار الطيار وتدخل سعر التوصيل وتصوّر الرسيت");
      return;
    }
    const feeNumber = Number(fee);
    if (!Number.isFinite(feeNumber) || feeNumber <= 0) {
      setError("سعر التوصيل غير صحيح");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const path = `${profile.branch_id}/${selectedOrder.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(path, receiptFile, { contentType: receiptFile.type || "image/jpeg" });
      if (uploadError) throw new Error(`فشل رفع صورة الرسيت: ${uploadError.message}`);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const { data, error: fnError } = await supabase.functions.invoke("dispatch-order", {
        body: {
          order_id: selectedOrder.id,
          driver_id: driverId,
          delivery_fee_after_tax: feeNumber,
          receipt_photo_url: path,
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (fnError) throw new Error(fnError.message);

      setResult(data as Record<string, unknown>);
      setStep("pick_order");
      setSelectedOrder(null);
      loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حصل خطأ غير متوقع");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  if (step === "confirm" && selectedOrder) {
    return (
      <div className="card">
        <button className="btn-link" onClick={() => setStep("pick_order")}>
          &larr; رجوع للقائمة
        </button>
        <h2>تسجيل خروج الأوردر #{selectedOrder.pos_order_id ?? selectedOrder.id}</h2>
        <p className="muted">تليفون العميل: {selectedOrder.customer_phone}</p>

        {selectedOrderItems.length > 0 && (
          <div style={{ marginBottom: "var(--space-3)" }}>
            {selectedOrderItems.map((line) => (
              <div key={line.id} className="cart-line-wrap">
                <div className="cart-line">
                  <span>
                    {line.menu_items?.name ?? line.combo_offers?.name ?? "صنف"} × {line.quantity}
                  </span>
                </div>
                {line.combo_selection && <p className="muted" style={{ margin: "0 0 6px", fontSize: "0.85rem" }}>{line.combo_selection}</p>}
                {line.note && <p className="error-text" style={{ margin: "0 0 6px", fontSize: "0.85rem" }}>ملاحظة العميل: {line.note}</p>}
              </div>
            ))}
          </div>
        )}

        <label>
          اختيار الطيار
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">-- اختر الطيار --</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          سعر التوصيل بعد الضريبة (جنيه)
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="مثال: 24"
          />
        </label>

        <label>
          صورة الرسيت
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button className="btn-primary btn-large" disabled={submitting} onClick={confirmExit}>
          {submitting ? "جاري التأكيد..." : "تأكيد الخروج"}
        </button>
      </div>
    );
  }

  return (
    <div>
      {result && (
        <div className="card success-banner">
          <p>
            تم تسجيل الخروج بنجاح - SLA: {String(result.sla_minutes)} دقيقة - وقت التحضير:{" "}
            {String(result.prep_time_minutes)} دقيقة
          </p>
        </div>
      )}
      <h2>أوردرات جاهزة للخروج ({orders.length})</h2>
      {orders.length === 0 && <p className="muted">مفيش أوردرات بانتظار الخروج دلوقتي.</p>}
      <div className="order-list">
        {orders.map((o) => {
          const delayed = isPastPrepThreshold(o);
          const ringing = ringingOrderIds.has(o.id);
          return (
            <button
              key={o.id}
              className={`order-row${delayed ? " order-row-delayed" : ""}${ringing ? " order-row-new" : ""}`}
              onClick={() => pickOrder(o)}
            >
              <span className="order-row-id">
                #{o.pos_order_id ?? o.id}
                {ringing && <span className="badge-new">جديد</span>}
                {delayed && <span className="badge-delayed">متأخر في التحضير</span>}
              </span>
              <span>{o.customer_phone}</span>
              <span className="muted">{new Date(o.order_time).toLocaleTimeString("ar-EG")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
