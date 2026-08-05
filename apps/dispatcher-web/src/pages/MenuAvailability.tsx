import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { Profile } from "../lib/useProfile";

interface MenuCategory {
  id: number;
  name: string;
  display_order: number;
}
interface MenuItem {
  id: number;
  category_id: number;
  name: string;
}
interface Branch {
  id: number;
  name: string;
  region_id: number | null;
}
interface Closure {
  menu_item_id: number;
  branch_id: number;
}

export function MenuAvailability({ profile }: { profile: Profile }) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    const [categoriesRes, itemsRes, branchesRes, closuresRes] = await Promise.all([
      supabase.from("menu_categories").select("id, name, display_order").order("display_order"),
      supabase.from("menu_items").select("id, category_id, name").order("id"),
      supabase.from("branches").select("id, name, region_id").order("name"),
      supabase.from("menu_item_branch_closures").select("menu_item_id, branch_id"),
    ]);
    setCategories((categoriesRes.data as MenuCategory[]) ?? []);
    setItems((itemsRes.data as MenuItem[]) ?? []);
    setBranches((branchesRes.data as Branch[]) ?? []);
    setClosures((closuresRes.data as Closure[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const myBranches = useMemo(() => {
    if (profile.role === "general_manager") return branches;
    if (profile.role === "regional_manager") return branches.filter((b) => b.region_id === profile.region_id);
    if (profile.role === "branch_manager") return branches.filter((b) => b.id === profile.branch_id);
    return [];
  }, [branches, profile]);

  useEffect(() => {
    if (myBranches.length > 0 && selectedBranchId === null) {
      setSelectedBranchId(myBranches[0].id);
    }
  }, [myBranches, selectedBranchId]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<number, MenuItem[]>();
    for (const item of items) {
      const list = map.get(item.category_id) ?? [];
      list.push(item);
      map.set(item.category_id, list);
    }
    return map;
  }, [items]);

  const closedItemIds = useMemo(() => {
    if (selectedBranchId === null) return new Set<number>();
    return new Set(closures.filter((c) => c.branch_id === selectedBranchId).map((c) => c.menu_item_id));
  }, [closures, selectedBranchId]);

  async function toggleClosed(item: MenuItem, isClosed: boolean) {
    if (selectedBranchId === null) return;
    setError(null);
    setBusyKey(`${item.id}`);
    if (isClosed) {
      // currently closed -> reopen: delete the exception row
      const { error: deleteError } = await supabase
        .from("menu_item_branch_closures")
        .delete()
        .eq("menu_item_id", item.id)
        .eq("branch_id", selectedBranchId);
      if (deleteError) setError(deleteError.message);
      else setClosures((prev) => prev.filter((c) => !(c.menu_item_id === item.id && c.branch_id === selectedBranchId)));
    } else {
      // currently available -> close: insert an exception row
      const { data: sessionData } = await supabase.auth.getSession();
      const { error: insertError } = await supabase.from("menu_item_branch_closures").insert({
        menu_item_id: item.id,
        branch_id: selectedBranchId,
        closed_by: sessionData.session?.user.id ?? null,
      });
      if (insertError) setError(insertError.message);
      else setClosures((prev) => [...prev, { menu_item_id: item.id, branch_id: selectedBranchId }]);
    }
    setBusyKey(null);
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  if (myBranches.length === 0) {
    return <p className="error-text">معندكش فرع متعيّن عليك - كلم المدير العام.</p>;
  }

  return (
    <div>
      <h2>إقفال الأصناف حسب الفرع</h2>
      {error && <p className="error-text">{error}</p>}

      {myBranches.length > 1 && (
        <div className="card">
          <div className="inline-row">
            <label htmlFor="branch-select">الفرع</label>
            <select
              id="branch-select"
              value={selectedBranchId ?? ""}
              onChange={(e) => setSelectedBranchId(Number(e.target.value))}
            >
              {myBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {categories.map((category) => {
        const categoryItems = itemsByCategory.get(category.id) ?? [];
        if (categoryItems.length === 0) return null;
        return (
          <div key={category.id} className="card">
            <h2>{category.name}</h2>
            <div className="order-list">
              {categoryItems.map((item) => {
                const isClosed = closedItemIds.has(item.id);
                return (
                  <div key={item.id} className="pending-order-card card">
                    <div className="pending-order-header">
                      <strong>{item.name}</strong>
                      <span className={isClosed ? "error-text" : "muted"}>{isClosed ? "مقفول في الفرع ده" : "متاح"}</span>
                    </div>
                    <label className="radio-label">
                      <input
                        type="checkbox"
                        checked={!isClosed}
                        disabled={busyKey === `${item.id}`}
                        onChange={() => toggleClosed(item, isClosed)}
                      />
                      متاح في الفرع ده
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
