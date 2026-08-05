import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";

interface StaffUser {
  id: string;
  name: string;
  phone: string;
  role: string;
  branch_id: number | null;
  region_id: number | null;
  is_active: boolean;
}

interface Branch {
  id: number;
  name: string;
  region_id: number | null;
}

interface Region {
  id: number;
  name: string;
}

const ROLE_LABELS: Record<string, string> = {
  driver: "طيار",
  dispatcher: "ديسباتشر",
  branch_manager: "مدير فرع",
  regional_manager: "مدير منطقة",
  general_manager: "مدير عام",
  team_leader: "تيم ليدر",
  call_center: "كول سنتر",
};

const BRANCH_SCOPED_ROLES = ["driver", "dispatcher", "branch_manager"];
const REGION_SCOPED_ROLES = ["regional_manager"];

// Client-side mirror of create-user's authorization matrix - a UX filter
// only, not a security boundary. The function re-checks all of this
// itself regardless of what this dropdown offers.
function creatableRolesFor(callerRole: string): string[] {
  if (callerRole === "general_manager") {
    return ["driver", "dispatcher", "branch_manager", "regional_manager", "call_center", "team_leader", "general_manager"];
  }
  if (callerRole === "regional_manager") return ["branch_manager", "dispatcher", "driver"];
  if (callerRole === "branch_manager") return ["dispatcher", "driver"];
  return [];
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

export function UserManagement({ profile }: { profile: Profile }) {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  // Ids of inactive staff who have real order/complaint/rating/closure
  // history - checked with a lightweight existence query rather than
  // discovering it by letting delete-user reject the call, so the button
  // can be disabled with an explanation up front instead of erroring out.
  const [historyUserIds, setHistoryUserIds] = useState<Set<string>>(new Set());

  const creatableRoles = useMemo(() => creatableRolesFor(profile.role), [profile.role]);
  const ownRegionBranches = useMemo(
    () => branches.filter((b) => b.region_id === profile.region_id),
    [branches, profile.region_id],
  );
  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: number | null) => (id ? map.get(id) ?? `فرع #${id}` : "-");
  }, [branches]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(creatableRoles[0] ?? "");
  const [branchId, setBranchId] = useState<number | "">("");
  const [regionId, setRegionId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ phone: string; password: string } | null>(null);
  const [resetPasswordResult, setResetPasswordResult] = useState<{ phone: string; password: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function loadStaff() {
    const { data } = await supabase
      .from("users")
      .select("id, name, phone, role, branch_id, region_id, is_active")
      .neq("role", "customer")
      .order("name");
    const rows = (data as StaffUser[]) ?? [];
    setStaff(rows);
    setLoading(false);

    const inactiveIds = rows.filter((u) => !u.is_active).map((u) => u.id);
    if (inactiveIds.length === 0) {
      setHistoryUserIds(new Set());
      return;
    }
    const orClause = inactiveIds
      .flatMap((id) => [`driver_id.eq.${id}`, `dispatcher_id.eq.${id}`, `accepted_by.eq.${id}`, `cancelled_by.eq.${id}`])
      .join(",");
    const [ordersRes, complaintsRes, ratingsRes, closuresRes] = await Promise.all([
      supabase.from("orders").select("driver_id, dispatcher_id, accepted_by, cancelled_by").or(orClause),
      supabase.from("complaints").select("driver_id").in("driver_id", inactiveIds),
      supabase.from("order_ratings").select("customer_id").in("customer_id", inactiveIds),
      supabase.from("menu_item_branch_closures").select("closed_by").in("closed_by", inactiveIds),
    ]);
    const withHistory = new Set<string>();
    for (const o of ordersRes.data ?? []) {
      for (const id of [o.driver_id, o.dispatcher_id, o.accepted_by, o.cancelled_by]) {
        if (id) withHistory.add(id);
      }
    }
    for (const c of complaintsRes.data ?? []) if (c.driver_id) withHistory.add(c.driver_id);
    for (const r of ratingsRes.data ?? []) if (r.customer_id) withHistory.add(r.customer_id);
    for (const cl of closuresRes.data ?? []) if (cl.closed_by) withHistory.add(cl.closed_by);
    setHistoryUserIds(withHistory);
  }

  useEffect(() => {
    loadStaff();
    supabase
      .from("branches")
      .select("id, name, region_id")
      .order("name")
      .then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from("regions").select("id, name").order("name").then(({ data }) => setRegions((data as Region[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setName("");
    setPhone("");
    setRole(creatableRoles[0] ?? "");
    setBranchId("");
    setRegionId("");
  }

  async function submitCreate() {
    setError(null);
    if (!name.trim() || !phone.trim() || !role) {
      setError("لازم الاسم ورقم التليفون والدور");
      return;
    }
    if (BRANCH_SCOPED_ROLES.includes(role) && profile.role !== "branch_manager" && !branchId) {
      setError("لازم تختار الفرع");
      return;
    }
    if (REGION_SCOPED_ROLES.includes(role) && !regionId) {
      setError("لازم تختار المنطقة");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), phone: phone.trim(), role };
      if (BRANCH_SCOPED_ROLES.includes(role) && profile.role !== "branch_manager") {
        body.branch_id = branchId;
      }
      if (REGION_SCOPED_ROLES.includes(role)) {
        body.region_id = regionId;
      }
      const res = await callFunction<{ phone: string; initial_password: string }>("create-user", body);
      setLastCreated({ phone: res.phone, password: res.initial_password });
      resetForm();
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إنشاء الحساب");
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivate(userId: string, userName: string) {
    if (!confirm(`متأكد إنك عايز توقف حساب "${userName}"؟`)) return;
    setBusyKey(`deactivate-${userId}`);
    setError(null);
    try {
      await callFunction("deactivate-user", { user_id: userId });
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إيقاف الحساب");
    } finally {
      setBusyKey(null);
    }
  }

  async function reactivate(userId: string, userName: string) {
    if (!confirm(`ترجّع حساب "${userName}" يشتغل تاني؟`)) return;
    setBusyKey(`reactivate-${userId}`);
    setError(null);
    try {
      await callFunction("reactivate-user", { user_id: userId });
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إعادة تفعيل الحساب");
    } finally {
      setBusyKey(null);
    }
  }

  async function resetPassword(userId: string, userName: string) {
    if (!confirm(`تغيّر باسورد "${userName}"؟ الباسورد القديم هيبقى مش شغال.`)) return;
    setBusyKey(`reset-${userId}`);
    setError(null);
    setResetPasswordResult(null);
    try {
      const res = await callFunction<{ phone: string; new_password: string }>("reset-user-password", { user_id: userId });
      setResetPasswordResult({ phone: res.phone, password: res.new_password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تغيير الباسورد");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteUser(userId: string, userName: string) {
    if (!confirm(`حذف حساب "${userName}" نهائيًا؟ الخطوة دي مش قابلة للتراجع.`)) return;
    setBusyKey(`delete-${userId}`);
    setError(null);
    try {
      await callFunction("delete-user", { user_id: userId });
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل حذف الحساب");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      <div className="card">
        <h2>إضافة موظف جديد</h2>

        {lastCreated && (
          <div className="success-banner card">
            <p>
              اتعمل الحساب بنجاح للرقم <strong>{lastCreated.phone}</strong>.
            </p>
            <p className="error-text">
              الباسورد المبدئي: <strong>{lastCreated.password}</strong>
              <br />
              انسخه وابعته للموظف دلوقتي — مش هيتعرض تاني.
            </p>
            <button className="btn-link" onClick={() => setLastCreated(null)}>
              تمام، قفلت
            </button>
          </div>
        )}

        {resetPasswordResult && (
          <div className="success-banner card">
            <p>
              اتغير باسورد <strong>{resetPasswordResult.phone}</strong>.
            </p>
            <p className="error-text">
              الباسورد الجديد: <strong>{resetPasswordResult.password}</strong>
              <br />
              انسخه وابعته للموظف دلوقتي — مش هيتعرض تاني.
            </p>
            <button className="btn-link" onClick={() => setResetPasswordResult(null)}>
              تمام، قفلت
            </button>
          </div>
        )}

        <label>
          الاسم
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          رقم التليفون
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
        </label>
        <label>
          الدور
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {creatableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        {BRANCH_SCOPED_ROLES.includes(role) && profile.role === "general_manager" && (
          <label>
            الفرع
            <select value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">-- اختر الفرع --</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {BRANCH_SCOPED_ROLES.includes(role) && profile.role === "branch_manager" && (
          <p className="muted">الفرع: نفس فرعك تلقائيًا.</p>
        )}
        {BRANCH_SCOPED_ROLES.includes(role) && profile.role === "regional_manager" && (
          <label>
            الفرع (فروع منطقتك بس)
            <select value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">-- اختر الفرع --</option>
              {ownRegionBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {REGION_SCOPED_ROLES.includes(role) && (
          <label>
            المنطقة
            <select value={regionId} onChange={(e) => setRegionId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">-- اختر المنطقة --</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="error-text">{error}</p>}

        <button className="btn-primary btn-large" disabled={submitting} onClick={submitCreate}>
          {submitting ? "جاري الإنشاء..." : "إنشاء الحساب"}
        </button>
      </div>

      <div className="card">
        <h2>الموظفين ({staff.length})</h2>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الدور</th>
                <th>التليفون</th>
                <th>الفرع</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => {
                const isSelf = u.id === profile.id;
                const blockedByHistory = !u.is_active && historyUserIds.has(u.id);
                return (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{ROLE_LABELS[u.role] ?? u.role}</td>
                    <td className="num-cell">{u.phone}</td>
                    <td>{branchName(u.branch_id)}</td>
                    <td>
                      <span className={u.is_active ? "badge-active" : "badge-inactive"}>
                        {u.is_active ? "شغال" : "موقوف"}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        {!isSelf && (
                          <button className="btn-sm btn-link" disabled={busyKey === `reset-${u.id}`} onClick={() => resetPassword(u.id, u.name)}>
                            تغيير الباسورد
                          </button>
                        )}
                        {u.is_active && !isSelf && (
                          <button className="btn-sm btn-danger" disabled={busyKey === `deactivate-${u.id}`} onClick={() => deactivate(u.id, u.name)}>
                            إيقاف
                          </button>
                        )}
                        {!u.is_active && (
                          <button className="btn-sm btn-primary" disabled={busyKey === `reactivate-${u.id}`} onClick={() => reactivate(u.id, u.name)}>
                            إعادة التفعيل
                          </button>
                        )}
                        {!u.is_active && (
                          <button
                            className="btn-sm btn-danger"
                            disabled={busyKey === `delete-${u.id}` || blockedByHistory}
                            title={blockedByHistory ? "الحساب ده ليه أوردرات/شكاوى مرتبطة بيه، فمش ممكن حذفه نهائيًا - يفضل موقوف بس" : undefined}
                            onClick={() => deleteUser(u.id, u.name)}
                          >
                            حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
