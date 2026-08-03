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
    body,
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

  const creatableRoles = useMemo(() => creatableRolesFor(profile.role), [profile.role]);
  const ownRegionBranches = useMemo(
    () => branches.filter((b) => b.region_id === profile.region_id),
    [branches, profile.region_id],
  );

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(creatableRoles[0] ?? "");
  const [branchId, setBranchId] = useState<number | "">("");
  const [regionId, setRegionId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{ phone: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadStaff() {
    const { data } = await supabase
      .from("users")
      .select("id, name, phone, role, branch_id, region_id, is_active")
      .neq("role", "customer")
      .order("name");
    setStaff((data as StaffUser[]) ?? []);
    setLoading(false);
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
    setBusyId(userId);
    setError(null);
    try {
      await callFunction("deactivate-user", { user_id: userId });
      loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إيقاف الحساب");
    } finally {
      setBusyId(null);
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
        <div className="order-list">
          {staff.map((u) => (
            <div key={u.id} className="order-row" style={{ cursor: "default" }}>
              <span className="order-row-id">
                {u.name}
                {!u.is_active && <span className="badge-delayed">موقوف</span>}
              </span>
              <span className="muted">
                {ROLE_LABELS[u.role] ?? u.role} - {u.phone}
              </span>
              {u.is_active && u.id !== profile.id && (
                <button className="btn-danger" disabled={busyId === u.id} onClick={() => deactivate(u.id, u.name)}>
                  إيقاف
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
