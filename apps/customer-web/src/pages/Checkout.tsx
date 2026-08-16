import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { Branch, CustomerAddress, Region, formatAddressSummary, resolveServingBranch } from "../lib/addressTypes";

// create-order (edge function) errors are English strings meant for logs/
// staff tooling - translate the ones a customer can actually hit here so
// they never see raw English on the checkout page.
const SERVER_ERROR_TRANSLATIONS: Record<string, string> = {
  "this branch does not offer delivery": "للأسف الفرع القريب من العنوان ده مش بيوصل دلوقتي - جرب عنوان تاني أو كلمنا على 19860",
  "this address has no nearest branch set": "العنوان ده لسه معندوش أقرب فرع محدد - عدّله من صفحة العناوين",
  "address not found": "العنوان ده مش موجود - جرب تختار عنوان تاني",
  "this address does not belong to you": "حصل خطأ في العنوان - جرب تسجل خروج ودخول تاني",
  "items must be a non-empty array": "سلتك فاضية",
  "voucher code not found": "كود الخصم ده مش موجود",
  "voucher code is not active": "كود الخصم ده مش شغال دلوقتي",
  "voucher code has expired": "كود الخصم ده منتهي الصلاحية",
  "voucher code has no uses remaining": "كود الخصم ده خلص استخدامه",
};

function formatHour(time: string): string {
  const [hStr, mStr] = time.slice(0, 5).split(":");
  const h = Number(hStr);
  const period = h < 12 ? "صباحًا" : h < 18 ? "بعد الضهر" : "بعد نص الليل";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mStr === "00" ? `${h12} ${period}` : `${h12}:${mStr} ${period}`;
}

function translateServerError(message: string, hoursNote: string | null): string {
  if (message === "outside business hours" && hoursNote) return hoursNote;
  return SERVER_ERROR_TRANSLATIONS[message] ?? "حصل خطأ وإحنا بنجهز طلبك - جرب تاني أو كلمنا على 19860";
}

export function Checkout() {
  const { session, loading: authLoading } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "instapay_transfer">("cash");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successOrderId, setSuccessOrderId] = useState<number | null>(null);
  const [redirectNotice, setRedirectNotice] = useState<{ from: string; to: string } | null>(null);
  const [hoursNote, setHoursNote] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherState, setVoucherState] = useState<
    { checking: false; result: { valid: boolean; discount_amount: number; reason: string | null } | null } | { checking: true; result: null }
  >({ checking: false, result: null });

  const selectedAddress = useMemo(
    () => addresses.find((a) => a.id === selectedAddressId) ?? null,
    [addresses, selectedAddressId],
  );
  const servingBranch = useMemo(
    () => resolveServingBranch(selectedAddress?.nearest_branch_id ?? null, branches),
    [selectedAddress, branches],
  );
  const [zoneFee, setZoneFee] = useState<number | null>(null);
  const [zoneName, setZoneName] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedAddress?.zone_id) {
      setZoneFee(null);
      setZoneName(null);
      return;
    }
    // Security audit finding MEDIUM-1 (Batch 6): reads via the
    // get_zone_delivery_fee RPC (bounded to exactly this one zone_id)
    // instead of a direct delivery_zones table read - a customer session
    // used to be able to bulk-read every zone's price this same table this
    // way; the RPC closes that off while this single-zone lookup keeps
    // working exactly as before.
    supabase
      .rpc("get_zone_delivery_fee", { p_zone_id: selectedAddress.zone_id })
      .then(({ data }) => {
        const row = (data as { delivery_fee: number; zone_name: string; is_active: boolean }[] | null)?.[0];
        // A zone can be disabled after an address saved it - create-order
        // treats that the same way (falls back to the branch's flat fee),
        // so this mirrors that instead of showing a retired zone's fee.
        if (!row || !row.is_active) {
          setZoneFee(null);
          setZoneName(null);
          return;
        }
        setZoneFee(row.delivery_fee);
        setZoneName(row.zone_name);
      });
  }, [selectedAddress]);
  // Mirrors create-order's own fallback order (zone fee, then flat branch
  // fee) so what the customer sees here matches what actually gets charged.
  const deliveryFee = zoneFee ?? servingBranch?.delivery_fee ?? 0;

  // Read-only preview via check_voucher (0064) - never redeems the code,
  // so it's safe to re-run on every keystroke/cart change. The real
  // redemption + atomic used_count increment only ever happens server-side
  // inside create-order at actual submit time, on its own recomputed
  // subtotal - this preview is purely so the customer sees the discount
  // before confirming, never something create-order trusts as input.
  useEffect(() => {
    const trimmed = voucherCode.trim();
    if (!trimmed) {
      setVoucherState({ checking: false, result: null });
      return;
    }
    setVoucherState({ checking: true, result: null });
    const timer = setTimeout(() => {
      supabase
        .rpc("check_voucher", { p_code: trimmed, p_subtotal: cart.total })
        .then(({ data, error }) => {
          const row = (data as { valid: boolean; discount_amount: number; reason: string | null }[] | null)?.[0];
          setVoucherState({
            checking: false,
            result: error || !row ? { valid: false, discount_amount: 0, reason: "حصل خطأ وإحنا بنتأكد من الكود" } : row,
          });
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [voucherCode, cart.total]);

  const discountAmount = voucherState.result?.valid ? voucherState.result.discount_amount : 0;
  const orderTotal = Math.max(0, cart.total + deliveryFee - discountAmount);

  useEffect(() => {
    if (!authLoading && !session) navigate("/login");
  }, [authLoading, session, navigate]);

  useEffect(() => {
    supabase
      .from("business_hours")
      .select("opens_at, closes_at")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setHoursNote(`الموقع بيستقبل أوردرات من ${formatHour(data.opens_at)} لحد ${formatHour(data.closes_at)} بس`);
      });
  }, []);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      supabase.from("customer_addresses").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }),
      supabase.from("regions").select("id, name").order("name"),
      supabase
        .from("branches")
        .select("id, name, region_id, is_delivery_available, delivery_fallback_branch_id, delivery_fee")
        .order("name"),
    ]).then(([addressesRes, regionsRes, branchesRes]) => {
      const loadedAddresses = (addressesRes.data as CustomerAddress[]) ?? [];
      setAddresses(loadedAddresses);
      setRegions((regionsRes.data as Region[]) ?? []);
      setBranches((branchesRes.data as Branch[]) ?? []);
      if (loadedAddresses.length > 0) setSelectedAddressId(loadedAddresses[0].id);
      setLoading(false);
    });
  }, [session]);

  async function submitOrder() {
    setError(null);
    if (cart.lines.length === 0) return setError("سلتك فاضية");
    if (!selectedAddressId) return setError("اختار عنوان التوصيل");
    if (paymentMethod === "instapay_transfer" && !proofFile) {
      return setError("لازم صورة إثبات التحويل لو الدفع انستاباي");
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      let paymentProofUrl: string | undefined;
      if (paymentMethod === "instapay_transfer" && proofFile) {
        // Uploaded server-side (upload-payment-proof edge function) - the
        // server checks the actual file bytes against real image
        // signatures rather than trusting this File object's declared/
        // guessed type.
        const formData = new FormData();
        formData.append("file", proofFile);
        const { data: uploadData, error: uploadError } = await supabase.functions.invoke<{ path: string }>(
          "upload-payment-proof",
          { body: formData, headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        );
        if (uploadError) throw new Error(`فشل رفع إثبات الدفع: ${uploadError.message}`);
        paymentProofUrl = uploadData!.path;
      }
      const { data, error: fnError } = await supabase.functions.invoke("create-order", {
        body: {
          address_id: selectedAddressId,
          items: cart.lines.map((l) => ({
            menu_item_id: l.menu_item_id,
            combo_offer_id: l.combo_offer_id,
            quantity: l.quantity,
            combo_choice_option_ids: l.comboChoiceOptionIds,
            note: l.note,
          })),
          payment_method: paymentMethod,
          payment_proof_url: paymentProofUrl,
          voucher_code: voucherState.result?.valid ? voucherCode.trim() : undefined,
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (fnError) {
        // supabase-js's FunctionsHttpError.message is a generic "non-2xx
        // status code" string - the actual server error text (e.g. "this
        // branch does not offer delivery") is only in the raw response
        // body via .context, so it needs an explicit extra fetch/parse to
        // surface anything useful to the customer.
        let serverMessage: string | null = null;
        const context = (fnError as { context?: Response }).context;
        if (context) {
          try {
            const body = await context.clone().json();
            serverMessage = typeof body?.error === "string" ? body.error : null;
          } catch {
            // response body wasn't JSON - fall through to the generic message
          }
        }
        throw new Error(
          serverMessage ? translateServerError(serverMessage, hoursNote) : translateServerError("", hoursNote),
        );
      }

      const result = data as {
        order_id: number;
        redirected_from: string | null;
        serving_branch_name: string | null;
      };
      cart.clear();
      if (result.redirected_from && result.serving_branch_name) {
        setRedirectNotice({ from: result.redirected_from, to: result.serving_branch_name });
      }
      setSuccessOrderId(result.order_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إرسال الطلب");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="wrap section">
        <p className="muted">جاري التحميل...</p>
      </div>
    );
  }

  if (successOrderId != null) {
    return (
      <div className="wrap section">
        <div className="auth-card" style={{ margin: "0 auto" }}>
          <h1>تم إرسال طلبك!</h1>
          <p className="muted" style={{ textAlign: "center", marginTop: "var(--space-2)" }}>
            رقم طلبك #{successOrderId}. هنتصل بيك لو احتجنا أي تفاصيل، وهيوصلك في أقرب وقت.
          </p>
          {redirectNotice && (
            <p className="muted" style={{ textAlign: "center", marginTop: "var(--space-2)" }}>
              فرع {redirectNotice.from} صالة وتيك أواي بس دلوقتي، فطلبك هيتوصلك من فرع {redirectNotice.to}.
            </p>
          )}
          <Link to="/orders" className="btn btn-primary" style={{ marginTop: "var(--space-4)" }}>
            تابع طلبك
          </Link>
          <Link to="/menu" className="btn-link" style={{ display: "block", textAlign: "center", marginTop: "var(--space-3)" }}>
            رجوع للمنيو
          </Link>
        </div>
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="wrap section">
        <h1>استكمال الطلب</h1>
        <p className="muted">سلتك فاضية.</p>
        <Link to="/menu" className="btn btn-primary" style={{ marginTop: "var(--space-3)" }}>
          شوف المنيو
        </Link>
      </div>
    );
  }

  if (addresses.length === 0) {
    return (
      <div className="wrap section">
        <h1>استكمال الطلب</h1>
        <p className="muted">محتاج تضيف عنوان توصيل الأول.</p>
        <Link to="/addresses" className="btn btn-primary" style={{ marginTop: "var(--space-3)" }}>
          إضافة عنوان
        </Link>
      </div>
    );
  }

  return (
    <div className="wrap section">
      <h1>استكمال الطلب</h1>

      <div className="card" style={{ marginTop: "var(--space-4)" }}>
        <h2 className="section-title" style={{ fontSize: "1.3rem" }}>
          طلبك
        </h2>
        {cart.lines.map((line) => (
          <div key={line.key} className="checkout-line-wrap">
            <div className="checkout-line">
              <span>
                {line.name} × {line.quantity}
              </span>
              <span>{line.unit_price * line.quantity} ج</span>
            </div>
            {line.comboChoiceLabels && line.comboChoiceLabels.length > 0 && (
              <p className="muted checkout-line-choices">{line.comboChoiceLabels.join(" - ")}</p>
            )}
            <input
              className="checkout-line-note"
              placeholder="ملاحظة على الصنف ده (اختياري) - زي: من غير تقلية"
              value={line.note ?? ""}
              onChange={(e) => cart.setNote(line.key, e.target.value)}
            />
          </div>
        ))}
        <div className="checkout-line">
          <span>الإجمالي الفرعي</span>
          <span>{cart.total} ج</span>
        </div>
        {servingBranch && (
          <div className="checkout-line">
            <span>الفرع</span>
            <span>{servingBranch.name}</span>
          </div>
        )}
        {zoneName && (
          <div className="checkout-line">
            <span>منطقة التوصيل</span>
            <span>{zoneName}</span>
          </div>
        )}
        <div className="checkout-line">
          <span>رسوم التوصيل</span>
          <span>{deliveryFee} ج</span>
        </div>

        <div className="field" style={{ marginTop: "var(--space-2)" }}>
          <label htmlFor="voucher-code">كود خصم (اختياري)</label>
          <input
            id="voucher-code"
            dir="ltr"
            value={voucherCode}
            onChange={(e) => setVoucherCode(e.target.value)}
            placeholder="اكتب الكود لو عندك"
          />
          {voucherState.checking && <span className="muted">بيتم التأكد من الكود...</span>}
          {!voucherState.checking && voucherState.result && !voucherState.result.valid && (
            <span className="error-text">{voucherState.result.reason}</span>
          )}
          {!voucherState.checking && voucherState.result?.valid && (
            <span className="muted" style={{ color: "var(--color-primary)" }}>
              الكود اشتغل! خصم {voucherState.result.discount_amount} ج
            </span>
          )}
        </div>

        {discountAmount > 0 && (
          <div className="checkout-line">
            <span>خصم الكود</span>
            <span>- {discountAmount} ج</span>
          </div>
        )}
        <div className="checkout-line checkout-total">
          <strong>الإجمالي</strong>
          <strong>{orderTotal} ج</strong>
        </div>
      </div>

      <div className="card" style={{ marginTop: "var(--space-3)" }}>
        <h2 className="section-title" style={{ fontSize: "1.3rem" }}>
          هتوصل فين؟
        </h2>
        {addresses.length > 1 ? (
          <div className="address-pick-list">
            {addresses.map((addr) => (
              <label key={addr.id} className="address-pick-option">
                <input
                  type="radio"
                  name="address"
                  checked={selectedAddressId === addr.id}
                  onChange={() => setSelectedAddressId(addr.id)}
                />
                <span>
                  {addr.label && <strong>{addr.label} - </strong>}
                  {formatAddressSummary(addr, regions, branches)}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p>{formatAddressSummary(addresses[0], regions, branches)}</p>
        )}
        <Link to="/addresses" className="btn-link">
          إدارة العناوين
        </Link>
      </div>

      <div className="card" style={{ marginTop: "var(--space-3)" }}>
        <h2 className="section-title" style={{ fontSize: "1.3rem" }}>
          طريقة الدفع
        </h2>
        <label className="radio-label">
          <input
            type="radio"
            name="payment"
            checked={paymentMethod === "cash"}
            onChange={() => setPaymentMethod("cash")}
          />
          كاش عند الاستلام
        </label>
        <label className="radio-label">
          <input
            type="radio"
            name="payment"
            checked={paymentMethod === "instapay_transfer"}
            onChange={() => setPaymentMethod("instapay_transfer")}
          />
          تحويل انستاباي
        </label>
        {paymentMethod === "instapay_transfer" && (
          <div style={{ marginTop: "var(--space-2)" }}>
            <p className="muted">
              حوّل على <strong>01040421166</strong> (باسم أ. عبد الباقي - حساب بنكي مش محفظة موبايل)، وارفع صورة
              إثبات التحويل هنا.
            </p>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              style={{ marginTop: "var(--space-2)" }}
            />
          </div>
        )}
      </div>

      {error && <p className="error-text" style={{ marginTop: "var(--space-3)" }}>{error}</p>}

      <button className="btn btn-primary btn-lg" style={{ width: "100%", marginTop: "var(--space-4)" }} onClick={submitOrder} disabled={submitting}>
        {submitting ? "جاري الإرسال..." : `تأكيد الطلب - ${orderTotal} ج`}
      </button>
    </div>
  );
}
