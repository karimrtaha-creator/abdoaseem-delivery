import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";
import { downloadCsv } from "../lib/csv";

interface Voucher {
  id: number;
  code: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  max_uses: number | null;
  used_count: number;
  min_order_value: number | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

// Direct table access under RLS (vouchers_all_general_manager, 0064) - same
// pattern as delivery_zones/menu_items CRUD elsewhere in this file's
// sibling screens. Redemption itself never happens here or via any client
// call; it's server-side only, inside create_order_with_items.
export function VoucherManagement({ profile }: { profile: Profile }) {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [minOrderValue, setMinOrderValue] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const { data, error: loadError } = await supabase.from("vouchers").select("*").order("created_at", { ascending: false });
    if (loadError) {
      setError(loadError.message);
    } else {
      setVouchers((data as Voucher[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(discountValue);
    if (!code.trim()) return setError("اكتب كود");
    if (!value || value <= 0) return setError("اكتب قيمة خصم أكبر من صفر");
    if (discountType === "percentage" && value > 100) return setError("النسبة مينفعش تعدي 100%");

    setCreating(true);
    const { error: insertError } = await supabase.from("vouchers").insert({
      code: code.trim().toUpperCase(),
      discount_type: discountType,
      discount_value: value,
      max_uses: maxUses ? Number(maxUses) : null,
      min_order_value: minOrderValue ? Number(minOrderValue) : null,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      created_by: profile.id,
    });
    setCreating(false);
    if (insertError) {
      setError(insertError.code === "23505" ? "الكود ده موجود قبل كده" : insertError.message);
      return;
    }
    setCode("");
    setDiscountValue("");
    setMaxUses("");
    setMinOrderValue("");
    setExpiresAt("");
    load();
  }

  async function toggleActive(v: Voucher) {
    await supabase.from("vouchers").update({ is_active: !v.is_active }).eq("id", v.id);
    load();
  }

  async function remove(v: Voucher) {
    if (!confirm(`متأكد من مسح الكود "${v.code}"؟`)) return;
    await supabase.from("vouchers").delete().eq("id", v.id);
    load();
  }

  // Every redemption is already on the order itself (voucher_code +
  // discount_amount, set atomically inside create_order_with_items) - no
  // separate redemptions log needed, this just reads the orders that used
  // one. general_manager already has broad orders SELECT access elsewhere
  // in this app, so this reuses that same RLS-granted read, not a new path.
  async function exportUsageReport() {
    setExporting(true);
    const { data, error: exportError } = await supabase
      .from("orders")
      .select("id, order_time, voucher_code, discount_amount, branch_id, customer_phone, status, branches(name)")
      .not("voucher_code", "is", null)
      .order("order_time", { ascending: false });
    setExporting(false);
    if (exportError) return setError(exportError.message);

    const rows = (data ?? []) as unknown as {
      id: number;
      order_time: string;
      voucher_code: string;
      discount_amount: number;
      customer_phone: string;
      status: string;
      branches: { name: string } | null;
    }[];
    const header = ["رقم الأوردر", "التاريخ", "الكود", "قيمة الخصم", "الفرع", "تليفون العميل", "حالة الأوردر"];
    const body = rows.map((r) => [
      r.id,
      new Date(r.order_time).toLocaleString("ar-EG"),
      r.voucher_code,
      r.discount_amount,
      r.branches?.name ?? "",
      r.customer_phone,
      r.status,
    ]);
    downloadCsv(`تقرير-أكواد-الخصم-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      <div className="card">
        <h2>إضافة كود خصم جديد</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          العميل بيكتب الكود ده في صفحة الدفع فيتخصم من قيمة طلبه. أي خانة تسيبها فاضية معناها إنها من غير قيد
          خالص (استخدام بلا حدود، من غير حد أدنى للأوردر، من غير تاريخ انتهاء).
        </p>
        <form onSubmit={create}>
          <div className="field">
            <label htmlFor="voucher-new-code">الكود اللي العميل هيكتبه</label>
            <input id="voucher-new-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="GHABASHY20" />
            <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
              حروف إنجليزي وأرقام، من غير مسافات - هيتسجل كبيتال أوتوماتيك.
            </p>
          </div>
          <div className="field">
            <label htmlFor="voucher-type">نوع الخصم</label>
            <select id="voucher-type" value={discountType} onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed")}>
              <option value="percentage">نسبة مئوية (%) - مثلاً 15% من قيمة الأوردر</option>
              <option value="fixed">مبلغ ثابت (ج) - مثلاً 20 جنيه ثابتة</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="voucher-value">
              {discountType === "percentage" ? "النسبة (من غير علامة %)" : "المبلغ بالجنيه"}
            </label>
            <input
              id="voucher-value"
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountType === "percentage" ? "مثال: 15" : "مثال: 20"}
            />
          </div>
          <div className="field">
            <label htmlFor="voucher-min-order">أقل قيمة أوردر يشتغل عندها الكود (اختياري)</label>
            <input
              id="voucher-min-order"
              type="number"
              value={minOrderValue}
              onChange={(e) => setMinOrderValue(e.target.value)}
              placeholder="مثال: 200"
            />
            <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
              لو حطيت 200، الكود مش هيشتغل إلا لو قيمة السلة 200 جنيه فأكتر.
            </p>
          </div>
          <div className="field">
            <label htmlFor="voucher-max-uses">أقصى عدد مرات استخدام إجمالي (اختياري)</label>
            <input id="voucher-max-uses" type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="مثال: 100" />
            <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
              العدد ده بيتوزع على كل العملاء مع بعض - لكن كل عميل برضه مينفعش يستخدم نفس الكود مرتين، حتى لو
              العدد لسه فاضل.
            </p>
          </div>
          <div className="field">
            <label htmlFor="voucher-expires">تاريخ انتهاء الصلاحية (اختياري)</label>
            <input id="voucher-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn-primary" type="submit" disabled={creating}>
            {creating ? "جاري الإضافة..." : "إضافة الكود"}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: "var(--space-3)" }}>
        <div className="actions-cell" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>الأكواد ({vouchers.length})</h2>
          <button className="btn-sm btn-primary" onClick={exportUsageReport} disabled={exporting}>
            {exporting ? "جاري التصدير..." : "تصدير تقرير الاستخدام (CSV)"}
          </button>
        </div>
        {vouchers.length === 0 && <p className="muted">مفيش أكواد خصم لسه.</p>}
        {vouchers.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الخصم</th>
                <th>أقل قيمة أوردر</th>
                <th>عدد مرات الاستخدام / الحد الأقصى</th>
                <th>تاريخ الانتهاء</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => (
                <tr key={v.id}>
                  <td>{v.code}</td>
                  <td>{v.discount_type === "percentage" ? `${v.discount_value}%` : `${v.discount_value} ج`}</td>
                  <td>{v.min_order_value != null ? `${v.min_order_value} ج` : "بلا حد أدنى"}</td>
                  <td>
                    {v.used_count} / {v.max_uses ?? "∞"}
                  </td>
                  <td>{v.expires_at ? new Date(v.expires_at).toLocaleDateString("ar-EG") : "من غير تاريخ انتهاء"}</td>
                  <td>{v.is_active ? "شغال" : "متوقف"}</td>
                  <td>
                    <button className="btn-link" onClick={() => toggleActive(v)}>
                      {v.is_active ? "إيقاف" : "تشغيل"}
                    </button>
                    <button className="btn-link" style={{ color: "var(--color-alert)" }} onClick={() => remove(v)}>
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
