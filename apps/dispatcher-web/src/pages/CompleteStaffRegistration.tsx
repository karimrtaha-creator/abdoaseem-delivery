import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { callFunction } from "../lib/callFunction";

interface StaffRequest {
  id: number;
  requested_role: string;
  requested_branch_id: number | null;
  requested_region_id: number | null;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

interface Branch {
  id: number;
  name: string;
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
  call_center: "Agent",
};

// Same shape as _shared/roleScopes.ts, mirrored client-side for the form's
// conditional branch/region picker - not shared code (this repo doesn't
// share TS between frontend and edge functions), the server independently
// re-validates all of this regardless of what this form sends.
const BRANCH_SCOPED_ROLES = ["driver", "dispatcher", "branch_manager"];
const REGION_SCOPED_ROLES = ["regional_manager"];
const ALL_ROLES = Object.keys(ROLE_LABELS);


export function CompleteStaffRegistration({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<StaffRequest | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);

  const [name, setName] = useState("");
  const [role, setRole] = useState("driver");
  const [branchId, setBranchId] = useState<number | "">("");
  const [regionId, setRegionId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRequest() {
    const { data } = await supabase
      .from("staff_registration_requests")
      .select("id, requested_role, requested_branch_id, requested_region_id, status, requested_at, reviewed_at, rejection_reason")
      .eq("user_id", userId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRequest(data as StaffRequest | null);
    setLoading(false);
  }

  useEffect(() => {
    loadRequest();
    supabase.from("branches").select("id, name").order("name").then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from("regions").select("id, name").order("name").then(({ data }) => setRegions((data as Region[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("اكتب اسمك");
      return;
    }
    if (BRANCH_SCOPED_ROLES.includes(role) && !branchId) {
      setError("لازم تختار الفرع");
      return;
    }
    if (REGION_SCOPED_ROLES.includes(role) && !regionId) {
      setError("لازم تختار المنطقة");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { name: name.trim(), role };
      if (BRANCH_SCOPED_ROLES.includes(role)) payload.branch_id = branchId;
      if (REGION_SCOPED_ROLES.includes(role)) payload.region_id = regionId;
      await callFunction("submit-staff-registration", payload);
      await loadRequest();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إرسال الطلب");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="muted centered-page">جاري التحميل...</p>;

  if (request?.status === "pending") {
    return (
      <div className="centered-page">
        <div className="card">
          <p>
            طلبك قيد المراجعة - وظيفة <strong>{ROLE_LABELS[request.requested_role] ?? request.requested_role}</strong>.
          </p>
          <p className="muted">هيوصلك إشعار لما يتم قبول أو رفض الطلب.</p>
          <button className="btn-link" onClick={() => supabase.auth.signOut()}>
            تسجيل خروج
          </button>
        </div>
      </div>
    );
  }

  const wasRejected = request?.status === "rejected";

  return (
    <div className="centered-page">
      <div className="card login-card">
        <h1>طلب تسجيل موظف جديد</h1>
        {wasRejected && (
          <div className="error-banner">
            <p>طلبك السابق ({ROLE_LABELS[request!.requested_role] ?? request!.requested_role}) اتراجع.</p>
            {request!.rejection_reason && <p className="muted">السبب: {request!.rejection_reason}</p>}
            <p className="muted">تقدر تبعت طلب جديد تحت.</p>
          </div>
        )}
        <label>
          الاسم
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          الوظيفة المطلوبة
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        {BRANCH_SCOPED_ROLES.includes(role) && (
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
        <button className="btn-primary btn-large" disabled={submitting} onClick={submit}>
          {submitting ? "جاري الإرسال..." : "إرسال الطلب"}
        </button>
        <button className="btn-link" onClick={() => supabase.auth.signOut()}>
          تسجيل خروج
        </button>
      </div>
    </div>
  );
}
