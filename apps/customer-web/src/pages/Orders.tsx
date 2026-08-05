import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/AuthContext";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STEPS, OrderStatus } from "../lib/orderStatus";

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
  branches: { name: string } | null;
  order_items: OrderItemRow[];
}

export function Orders() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !session) navigate("/login");
  }, [authLoading, session, navigate]);

  async function load() {
    if (!session) return;
    const { data } = await supabase
      .from("orders")
      .select(
        "id, status, order_time, is_delayed, branches(name), order_items(id, quantity, unit_price, combo_selection, menu_items(name), combo_offers(name))",
      )
      .eq("customer_id", session.user.id)
      .order("order_time", { ascending: false });
    setOrders((data as unknown as OrderRow[]) ?? []);
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
            ABDO ASEEM
          </Link>
          <Link to="/menu" className="btn btn-ghost">
            المنيو
          </Link>
        </div>
      </header>

      <div className="wrap section">
        <h1>طلباتي</h1>

        {orders.length === 0 && <p className="muted" style={{ marginTop: "var(--space-3)" }}>لسه معملتش أي طلب.</p>}

        <div className="orders-list">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: OrderRow }) {
  const total = useMemo(
    () => order.order_items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    [order.order_items],
  );
  const isTerminalIssue = order.status === "cancelled" || order.status === "rejected";
  const currentStepIndex = ORDER_STATUS_STEPS.indexOf(order.status);
  const showOtp = order.status === "out_for_delivery" || order.status === "delayed";

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
