import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";

interface StaffRequest {
  id: number;
  user_id: string;
  requested_name: string;
  requested_role: string;
  requested_branch_id: number | null;
  requested_region_id: number | null;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  reviewed_by: string | null;
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

export function PendingApprovals({ profile: _profile }: { profile: Profile }) {
  const [requests, setRequests] = useState<StaffRequest[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [reviewerNames, setReviewerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    // RLS already scopes this to whatever the caller's role/branch/region
    // is allowed to see (general_manager: all, regional_manager: own
    // region, branch_manager: own branch) - no client-side filtering
    // needed for correctness, same principle as everywhere else in this app.
    const { data } = await supabase
      .from("staff_registration_requests")
      .select("*")
      .order("requested_at", { ascending: false });
    const rows = (data as StaffRequest[]) ?? [];
    setRequests(rows);
    setLoading(false);

    const reviewerIds = [...new Set(rows.map((r) => r.reviewed_by).filter((id): id is string => !!id))];
    if (reviewerIds.length > 0) {
      const { data: reviewers } = await supabase.from("users").select("id, name").in("id", reviewerIds);
      setReviewerNames(new Map((reviewers ?? []).map((u) => [u.id, u.name])));
    }
  }

  useEffect(() => {
    load();
    supabase.from("branches").select("id, name").order("name").then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from("regions").select("id, name").order("name").then(({ data }) => setRegions((data as Region[]) ?? []));
    const channel = supabase
      .channel("staff-requests-screen")
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_registration_requests" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: number | null) => (id ? map.get(id) ?? `فرع #${id}` : null);
  }, [branches]);

  const regionName = useMemo(() => {
    const map = new Map(regions.map((r) => [r.id, r.name]));
    return (id: number | null) => (id ? map.get(id) ?? `منطقة #${id}` : null);
  }, [regions]);

  const visible = filter === "pending" ? requests.filter((r) => r.status === "pending") : requests;

  async function approve(id: number) {
    setBusyId(id);
    setError(null);
    try {
      await callFunction("approve-staff-registration", { request_id: id, action: "approve" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشلت الموافقة");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: number) {
    const reason = prompt("سبب الرفض (اختياري):") ?? undefined;
    setBusyId(id);
    setError(null);
    try {
      await callFunction("approve-staff-registration", { request_id: id, action: "reject", rejection_reason: reason });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الرفض");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div className="card">
      <div className="inline-row" style={{ justifyContent: "space-between" }}>
        <h2>طلبات تسجيل الموظفين ({visible.length})</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")}>
          <option value="pending">قيد المراجعة بس</option>
          <option value="all">كل الطلبات</option>
        </select>
      </div>
      {error && <p className="error-text">{error}</p>}
      {visible.length === 0 && <p className="muted">مفيش طلبات{filter === "pending" ? " قيد المراجعة" : ""}.</p>}
      <div className="order-list">
        {visible.map((r) => (
          <div key={r.id} className="card pending-order-card">
            <div className="pending-order-header">
              <strong>
                {r.requested_name} - {ROLE_LABELS[r.requested_role] ?? r.requested_role}
              </strong>
              {r.status === "pending" && <span className="badge-new">قيد المراجعة</span>}
              {r.status === "approved" && <span className="badge-active">اتقبل</span>}
              {r.status === "rejected" && <span className="badge-inactive">اترفض</span>}
            </div>
            <p className="muted">
              {branchName(r.requested_branch_id) ? `الفرع: ${branchName(r.requested_branch_id)}` : ""}
              {regionName(r.requested_region_id) ? `المنطقة: ${regionName(r.requested_region_id)}` : ""}
              {" - "}
              {new Date(r.requested_at).toLocaleString("ar-EG")}
            </p>
            {r.status !== "pending" && (
              <p className="muted">
                {r.status === "approved" ? "وافق" : "رفض"} عليه:{" "}
                {r.reviewed_by ? reviewerNames.get(r.reviewed_by) ?? r.reviewed_by : "-"}
                {r.reviewed_at ? ` - ${new Date(r.reviewed_at).toLocaleString("ar-EG")}` : ""}
                {r.rejection_reason ? ` - السبب: ${r.rejection_reason}` : ""}
              </p>
            )}
            {r.status === "pending" && (
              <div className="actions-cell">
                <button className="btn-sm btn-primary" disabled={busyId === r.id} onClick={() => approve(r.id)}>
                  موافقة
                </button>
                <button className="btn-sm btn-danger" disabled={busyId === r.id} onClick={() => reject(r.id)}>
                  رفض
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
