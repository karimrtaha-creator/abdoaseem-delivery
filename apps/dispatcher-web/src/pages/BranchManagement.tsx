import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

interface Branch {
  id: number;
  name: string;
  region_id: number | null;
  is_delivery_available: boolean;
  delivery_fee: number;
}

interface Region {
  id: number;
  name: string;
}

interface StaffUser {
  id: string;
  name: string;
  phone: string;
  role: string;
  branch_id: number | null;
  region_id: number | null;
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

export function BranchManagement() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchRegion, setNewBranchRegion] = useState<number | "">("");
  const [newRegionName, setNewRegionName] = useState("");

  const [pickBranchManager, setPickBranchManager] = useState<Record<number, string>>({});
  const [pickRegionManager, setPickRegionManager] = useState<Record<number, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feeDrafts, setFeeDrafts] = useState<Record<number, string>>({});

  async function load() {
    const [branchesRes, regionsRes, staffRes] = await Promise.all([
      supabase.from("branches").select("id, name, region_id, is_delivery_available, delivery_fee").order("name"),
      supabase.from("regions").select("id, name").order("name"),
      supabase.from("users").select("id, name, phone, role, branch_id, region_id").neq("role", "customer").order("name"),
    ]);
    const loadedBranches = (branchesRes.data as Branch[]) ?? [];
    setBranches(loadedBranches);
    setFeeDrafts(Object.fromEntries(loadedBranches.map((b) => [b.id, String(b.delivery_fee)])));
    setRegions((regionsRes.data as Region[]) ?? []);
    setStaff((staffRes.data as StaffUser[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const regionName = useMemo(() => {
    const map = new Map(regions.map((r) => [r.id, r.name]));
    return (id: number | null) => (id ? map.get(id) ?? `منطقة #${id}` : "-");
  }, [regions]);

  const branchManagerOf = useMemo(() => {
    const map = new Map<number, StaffUser>();
    for (const u of staff) {
      if (u.role === "branch_manager" && u.branch_id != null) {
        map.set(u.branch_id, u);
      }
    }
    return map;
  }, [staff]);

  const regionManagerOf = useMemo(() => {
    const map = new Map<number, StaffUser>();
    for (const u of staff) {
      if (u.role === "regional_manager" && u.region_id != null) {
        map.set(u.region_id, u);
      }
    }
    return map;
  }, [staff]);

  async function addBranch() {
    setError(null);
    if (!newBranchName.trim()) return setError("اسم الفرع مطلوب");
    const { error: insertError } = await supabase
      .from("branches")
      .insert({ name: newBranchName.trim(), region_id: newBranchRegion || null, is_delivery_available: true });
    if (insertError) return setError(insertError.message);
    setNewBranchName("");
    setNewBranchRegion("");
    load();
  }

  async function addRegion() {
    setError(null);
    if (!newRegionName.trim()) return setError("اسم المنطقة مطلوب");
    const { error: insertError } = await supabase.from("regions").insert({ name: newRegionName.trim() });
    if (insertError) return setError(insertError.message);
    setNewRegionName("");
    load();
  }

  async function toggleDelivery(branch: Branch) {
    setBusyKey(`delivery-${branch.id}`);
    await supabase.from("branches").update({ is_delivery_available: !branch.is_delivery_available }).eq("id", branch.id);
    setBusyKey(null);
    load();
  }

  async function saveFee(branch: Branch) {
    setError(null);
    const value = Number(feeDrafts[branch.id]);
    if (Number.isNaN(value) || value < 0) return setError("رسم التوصيل لازم يكون رقم صحيح 0 أو أكبر");
    setBusyKey(`fee-${branch.id}`);
    const { error: updateError } = await supabase.from("branches").update({ delivery_fee: value }).eq("id", branch.id);
    setBusyKey(null);
    if (updateError) return setError(updateError.message);
    load();
  }

  async function assignBranchManager(branchId: number) {
    const userId = pickBranchManager[branchId];
    if (!userId) return;
    setBusyKey(`branch-${branchId}`);
    setError(null);
    setInfo(null);
    try {
      const res = await callFunction<{ displaced_user: { name: string } | null }>("assign-manager", {
        user_id: userId,
        target_type: "branch",
        target_id: branchId,
      });
      setInfo(
        res.displaced_user
          ? `تم التعيين - "${res.displaced_user.name}" بقى من غير فرع دلوقتي.`
          : "تم التعيين بنجاح.",
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التعيين");
    } finally {
      setBusyKey(null);
    }
  }

  async function assignRegionManager(regionId: number) {
    const userId = pickRegionManager[regionId];
    if (!userId) return;
    setBusyKey(`region-${regionId}`);
    setError(null);
    setInfo(null);
    try {
      const res = await callFunction<{ displaced_user: { name: string } | null }>("assign-manager", {
        user_id: userId,
        target_type: "region",
        target_id: regionId,
      });
      setInfo(
        res.displaced_user
          ? `تم التعيين - "${res.displaced_user.name}" بقى من غير منطقة دلوقتي.`
          : "تم التعيين بنجاح.",
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التعيين");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  return (
    <div>
      {error && <p className="error-text">{error}</p>}
      {info && (
        <div className="card success-banner">
          <p>{info}</p>
        </div>
      )}

      <div className="card">
        <h2>إضافة منطقة</h2>
        <div className="inline-row">
          <input placeholder="اسم المنطقة" value={newRegionName} onChange={(e) => setNewRegionName(e.target.value)} />
          <button className="btn-primary" onClick={addRegion}>
            إضافة
          </button>
        </div>
      </div>

      <div className="card">
        <h2>إضافة فرع</h2>
        <div className="inline-row">
          <input placeholder="اسم الفرع" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} />
          <select value={newBranchRegion} onChange={(e) => setNewBranchRegion(e.target.value ? Number(e.target.value) : "")}>
            <option value="">بدون منطقة</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={addBranch}>
            إضافة
          </button>
        </div>
      </div>

      <div className="card">
        <h2>المناطق ({regions.length})</h2>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>المنطقة</th>
                <th>مدير المنطقة</th>
                <th>تعيين مدير</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => {
                const manager = regionManagerOf.get(r.id);
                return (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className={manager ? undefined : "muted"}>{manager ? manager.name : "مفيش مدير معيّن"}</td>
                    <td>
                      <div className="actions-cell">
                        <select
                          value={pickRegionManager[r.id] ?? ""}
                          onChange={(e) => setPickRegionManager({ ...pickRegionManager, [r.id]: e.target.value })}
                        >
                          <option value="">-- اختر موظف --</option>
                          {staff.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.phone})
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-sm btn-primary"
                          disabled={busyKey === `region-${r.id}` || !pickRegionManager[r.id]}
                          onClick={() => assignRegionManager(r.id)}
                        >
                          تعيين
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>الفروع ({branches.length})</h2>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الفرع</th>
                <th>المنطقة</th>
                <th>مدير الفرع</th>
                <th>متاح للتوصيل</th>
                <th>رسم التوصيل</th>
                <th>تعيين مدير</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const manager = branchManagerOf.get(b.id);
                return (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{regionName(b.region_id)}</td>
                    <td className={manager ? undefined : "muted"}>{manager ? manager.name : "مفيش مدير معيّن"}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={b.is_delivery_available}
                        disabled={busyKey === `delivery-${b.id}`}
                        onChange={() => toggleDelivery(b)}
                      />
                    </td>
                    <td>
                      <div className="actions-cell">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          style={{ width: "70px" }}
                          value={feeDrafts[b.id] ?? ""}
                          onChange={(e) => setFeeDrafts({ ...feeDrafts, [b.id]: e.target.value })}
                        />
                        <button
                          className="btn-sm btn-primary"
                          disabled={busyKey === `fee-${b.id}` || feeDrafts[b.id] === String(b.delivery_fee)}
                          onClick={() => saveFee(b)}
                        >
                          حفظ
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <select
                          value={pickBranchManager[b.id] ?? ""}
                          onChange={(e) => setPickBranchManager({ ...pickBranchManager, [b.id]: e.target.value })}
                        >
                          <option value="">-- اختر موظف --</option>
                          {staff.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.phone})
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-sm btn-primary"
                          disabled={busyKey === `branch-${b.id}` || !pickBranchManager[b.id]}
                          onClick={() => assignBranchManager(b.id)}
                        >
                          تعيين
                        </button>
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
