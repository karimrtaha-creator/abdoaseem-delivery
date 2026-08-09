import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/AuthContext";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STEPS, OrderStatus } from "../lib/orderStatus";

const WHATSAPP_HELP_URL = "https://wa.me/201224444219?text=" + encodeURIComponent("عندي استفسار عن طلبي");

interface OrderItemRow {
  id: number;
  quantity: number;
  unit_price: number;
  combo_selection: string | null;
  menu_items: { name: string } | null;
  combo_offers: { name: string } | null;
}
interface OrderRow {
  id: number;
  status: OrderStatus;
  order_time: string;
  is_delayed: boolean | null;
  cancellation_reason: string | null;
  branches: { name: string } | null;
  order_items: OrderItemRow[];
}

export function Orders() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ratedOrderIds, setRatedOrderIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !session) navigate("/login");
  }, [authLoading, session, navigate]);

  async function load() {
    if (!session) return;
    const [ordersRes, ratingsRes] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, status, order_time, is_delayed, cancellation_reason, branches(name), order_items(id, quantity, unit_price, combo_selection, menu_items(name), combo_offers(name))",
        )
        .eq("customer_id", session.user.id)
        .order("order_time", { ascending: false }),
      supabase.from("order_ratings").select("order_id").eq("customer_id", session.user.id),
    ]);
    setOrders((ordersRes.data as unknown as OrderRow[]) ?? []);
    setRatedOrderIds(new Set(((ratingsRes.data as { order_id: number }[]) ?? []).map((r) => r.order_id)));
    setLoading(false);
  }

  useEffect(() => {
    if (!session) return;
    load();
    // Same live-refetch pattern already used across the staff dashboards
    // (AcceptanceLobby/Dashboard/Dispatch) - orders RLS already scopes
    // this to the caller's own rows (orders_select_customer, 0001), so a
    // broad "orders changed" trigger is safe here, it just re-reads
    // whatever this customer is allowed to see.
    const channel = supabase
      .channel("customer-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (authLoading || loading) {
    return (
      <div className="wrap section">
        <p className="muted">جاري التحميل...</p>
      </div>
    );
  }

  return (
    <div>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" style={{ textDecoration: "none" }}>
            كشري الغباشي
          </Link>
          <div className="user-chip">
            <a className="btn-link" href={WHATSAPP_HELP_URL} target="_blank" rel="noreferrer">
              مركز المساعدة
            </a>
            <Link to="/menu" className="btn btn-ghost">
              المنيو
            </Link>
          </div>
        </div>
      </header>

      <div className="wrap section">
        <h1>طلباتي</h1>

        {orders.length === 0 && <p className="muted" style={{ marginTop: "var(--space-3)" }}>لسه معملتش أي طلب.</p>}

        <div className="orders-list">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} alreadyRated={ratedOrderIds.has(order.id)} onChanged={load} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrderCard({
  order,
  alreadyRated,
  onChanged,
}: {
  order: OrderRow;
  alreadyRated: boolean;
  onChanged: () => void;
}) {
  const total = useMemo(
    () => order.order_items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    [order.order_items],
  );
  const isTerminalIssue = order.status === "cancelled" || order.status === "rejected";
  const currentStepIndex = ORDER_STATUS_STEPS.indexOf(order.status);
  const showOtp = order.status === "out_for_delivery" || order.status === "delayed";
  const canCancel = order.status === "pending_acceptance";

  return (
    <div className="card order-card">
      <div className="pending-order-header">
        <strong>طلب #{order.id}</strong>
        <span className="muted">{new Date(order.order_time).toLocaleString("ar-EG")}</span>
      </div>
      {order.branches && <p className="muted">من فرع {order.branches.name}</p>}

      {!isTerminalIssue ? (
        <div className="order-progress">
          {ORDER_STATUS_STEPS.map((step, i) => (
            <div key={step} className={`order-progress-step${i <= currentStepIndex ? " reached" : ""}`}>
              <span className="order-progress-dot" />
              <span>{ORDER_STATUS_LABELS[step]}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="error-text">{ORDER_STATUS_LABELS[order.status]}</p>
      )}

      {order.status === "cancelled" && (
        <p className="muted">
          الأوردر اتلغى. لو محتاج تفاصيل عن السبب،{" "}
          <a href={WHATSAPP_HELP_URL} target="_blank" rel="noreferrer">
            كلمنا
          </a>
          .
        </p>
      )}
      {order.status === "delayed" && <p className="error-text">الطلب متأخر شوية عن المتوقع، هيوصلك في أقرب وقت</p>}

      {showOtp && <DeliveryOtp orderId={order.id} />}

      <div className="order-items-list">
        {order.order_items.map((line) => (
          <div key={line.id} className="checkout-line-wrap">
            <div className="checkout-line">
              <span>
                {line.menu_items?.name ?? line.combo_offers?.name ?? "صنف"} × {line.quantity}
              </span>
              <span>{line.unit_price * line.quantity} ج</span>
            </div>
            {line.combo_selection && <p className="muted checkout-line-choices">{line.combo_selection}</p>}
          </div>
        ))}
        <div className="checkout-line checkout-total">
          <strong>الإجمالي</strong>
          <strong>{total} ج</strong>
        </div>
      </div>

      {canCancel && <CancelOrder orderId={order.id} onCancelled={onChanged} />}
      {order.status === "delivered" && <RateOrder orderId={order.id} alreadyRated={alreadyRated} onRated={onChanged} />}
    </div>
  );
}

function CancelOrder({ orderId, onCancelled }: { orderId: number; onCancelled: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setError("اكتب سبب الإلغاء");
    setError(null);
    setSubmitting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const { error: fnError } = await supabase.functions.invoke("cancel-order", {
      body: { order_id: orderId, reason: reason.trim() },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    setSubmitting(false);
    if (fnError) {
      setError("مقدرناش نلغي الطلب - جرب تاني أو كلمنا على 19860");
      return;
    }
    setOpen(false);
    onCancelled();
  }

  if (!open) {
    return (
      <button className="btn-link" style={{ marginTop: "var(--space-2)", color: "var(--color-alert)" }} onClick={() => setOpen(true)}>
        إلغاء الأوردر
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "var(--space-2)" }}>
      <div className="field">
        <label htmlFor={`cancel-reason-${orderId}`}>سبب الإلغاء</label>
        <input
          id={`cancel-reason-${orderId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ليه عايز تلغي الأوردر؟"
        />
      </div>
      {error && <span className="error-text">{error}</span>}
      <div className="inline-row" style={{ marginTop: "4px" }}>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
        </button>
        <button className="btn-link" type="button" onClick={() => setOpen(false)}>
          رجوع
        </button>
      </div>
    </form>
  );
}

function RateOrder({ orderId, alreadyRated, onRated }: { orderId: number; alreadyRated: boolean; onRated: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (alreadyRated) {
    return <p className="muted" style={{ marginTop: "var(--space-2)" }}>شكرًا على تقييمك للطلب ده</p>;
  }

  async function submit() {
    if (rating === 0) return setError("اختار عدد النجوم");
    setError(null);
    setSubmitting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    const { error: insertError } = await supabase
      .from("order_ratings")
      .insert({ order_id: orderId, customer_id: userId, rating, comment: comment.trim() || null });
    setSubmitting(false);
    if (insertError) {
      setError("مقدرناش نسجل التقييم - جرب تاني");
      return;
    }
    onRated();
  }

  return (
    <div style={{ marginTop: "var(--space-2)" }}>
      <p className="muted">قيّم الأوردر والسائق</p>
      <div className="star-picker">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`star-btn${n <= rating ? " filled" : ""}`}
            onClick={() => setRating(n)}
            aria-label={`${n} نجوم`}
          >
            ★
          </button>
        ))}
      </div>
      <div className="field">
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="أي تعليق؟ (اختياري)" />
      </div>
      {error && <span className="error-text">{error}</span>}
      <button className="btn btn-primary" onClick={submit} disabled={submitting}>
        {submitting ? "جاري الإرسال..." : "إرسال التقييم"}
      </button>
    </div>
  );
}

function DeliveryOtp({ orderId }: { orderId: number }) {
  const [state, setState] = useState<{ available: boolean; code?: string } | "loading" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    async function fetchOtp() {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const { data, error } = await supabase.functions.invoke("get-delivery-otp", {
        body: { order_id: orderId },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (cancelled) return;
      if (error) {
        setState("error");
        return;
      }
      setState(data as { available: boolean; code?: string });
    }
    fetchOtp();
    // Re-check every 20s - a fresh code can be issued if the driver's
    // resend-otp path was used, and this card has no realtime channel of
    // its own on otp_codes (that table is intentionally invisible to
    // every client role, including this one - only the edge function can
    // read it).
    const interval = setInterval(fetchOtp, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId]);

  if (state === "loading") return null;
  if (state === "error" || !state.available || !state.code) return null;

  return (
    <div className="delivery-otp">
      <p className="muted">قول الكود ده للسائق وقت الاستلام</p>
      <span className="delivery-otp-code">{state.code}</span>
    </div>
  );
}
