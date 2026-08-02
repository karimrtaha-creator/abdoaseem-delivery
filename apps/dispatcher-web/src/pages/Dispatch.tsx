import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";

interface PreparingOrder {
  id: number;
  pos_order_id: string | null;
  customer_phone: string;
  order_time: string;
}

interface Driver {
  id: string;
  name: string;
}

type Step = "pick_order" | "confirm";

export function Dispatch({ profile }: { profile: Profile }) {
  const [orders, setOrders] = useState<PreparingOrder[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("pick_order");

  const [selectedOrder, setSelectedOrder] = useState<PreparingOrder | null>(null);
  const [driverId, setDriverId] = useState("");
  const [fee, setFee] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function loadQueue() {
    setLoading(true);
    const [ordersRes, driversRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, pos_order_id, customer_phone, order_time")
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
    setOrders((ordersRes.data as PreparingOrder[]) ?? []);
    setDrivers((driversRes.data as Driver[]) ?? []);
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

  function pickOrder(order: PreparingOrder) {
    setSelectedOrder(order);
    setDriverId("");
    setFee("");
    setReceiptFile(null);
    setError(null);
    setResult(null);
    setStep("confirm");
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
          {result.otp_code_debug ? (
            <p className="error-text">
              وضع اختبار: لسه مفيش مزود SMS متصل - كود التسليم: {String(result.otp_code_debug)}
            </p>
          ) : null}
        </div>
      )}
      <h2>أوردرات جاهزة للخروج ({orders.length})</h2>
      {orders.length === 0 && <p className="muted">مفيش أوردرات بانتظار الخروج دلوقتي.</p>}
      <div className="order-list">
        {orders.map((o) => (
          <button key={o.id} className="order-row" onClick={() => pickOrder(o)}>
            <span className="order-row-id">#{o.pos_order_id ?? o.id}</span>
            <span>{o.customer_phone}</span>
            <span className="muted">{new Date(o.order_time).toLocaleTimeString("ar-EG")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
