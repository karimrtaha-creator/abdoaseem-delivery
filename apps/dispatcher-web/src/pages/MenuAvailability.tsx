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
interface ComboOffer {
  id: number;
  name: string;
}
interface ComboClosure {
  combo_offer_id: number;
  branch_id: number;
}

// profile isn't used for client-side scoping anymore - see myBranches'
// comment above. Kept in the signature only so this screen matches every
// other tab's ScreenFor(tab, profile) call shape.
export function MenuAvailability({ profile: _profile }: { profile: Profile }) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [combos, setCombos] = useState<ComboOffer[]>([]);
  const [comboClosures, setComboClosures] = useState<ComboClosure[]>([]);
  const [comboSectionLabel, setComboSectionLabel] = useState("الكومبوهات");
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    const [categoriesRes, itemsRes, branchesRes, closuresRes, combosRes, comboClosuresRes, comboSectionRes] = await Promise.all([
      supabase.from("menu_categories").select("id, name, display_order").order("display_order"),
      supabase.from("menu_items").select("id, category_id, name").order("display_order"),
      supabase.from("branches").select("id, name, region_id").order("name"),
      supabase.from("menu_item_branch_closures").select("menu_item_id, branch_id"),
      supabase.from("combo_offers").select("id, name").eq("is_active", true).order("id"),
      supabase.from("combo_offer_branch_closures").select("combo_offer_id, branch_id"),
      supabase.from("combo_section_settings").select("label").eq("id", 1).maybeSingle(),
    ]);
    setCategories((categoriesRes.data as MenuCategory[]) ?? []);
    setItems((itemsRes.data as MenuItem[]) ?? []);
    setBranches((branchesRes.data as Branch[]) ?? []);
    setClosures((closuresRes.data as Closure[]) ?? []);
    setCombos((combosRes.data as ComboOffer[]) ?? []);
    setComboClosures((comboClosuresRes.data as ComboClosure[]) ?? []);
    setComboSectionLabel(comboSectionRes.data?.label ?? "الكومبوهات");
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // branch_manager/regional_manager retired as roles (2026-08-21, Karim's
  // request) - this screen is only ever reached by general_manager/
  // team_leader now (see TABS_BY_ROLE), both with the same unrestricted
  // breadth here, matching their company-wide order visibility elsewhere
  // (RLS on menu_item_branch_closures already grants this, not just the UI).
  const myBranches = branches;

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

  const closedComboIds = useMemo(() => {
    if (selectedBranchId === null) return new Set<number>();
    return new Set(comboClosures.filter((c) => c.branch_id === selectedBranchId).map((c) => c.combo_offer_id));
  }, [comboClosures, selectedBranchId]);

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

  async function toggleComboClosed(combo: ComboOffer, isClosed: boolean) {
    if (selectedBranchId === null) return;
    setError(null);
    setBusyKey(`combo-${combo.id}`);
    if (isClosed) {
      const { error: deleteError } = await supabase
        .from("combo_offer_branch_closures")
        .delete()
        .eq("combo_offer_id", combo.id)
        .eq("branch_id", selectedBranchId);
      if (deleteError) setError(deleteError.message);
      else setComboClosures((prev) => prev.filter((c) => !(c.combo_offer_id === combo.id && c.branch_id === selectedBranchId)));
    } else {
      const { data: sessionData } = await supabase.auth.getSession();
      const { error: insertError } = await supabase.from("combo_offer_branch_closures").insert({
        combo_offer_id: combo.id,
        branch_id: selectedBranchId,
        closed_by: sessionData.session?.user.id ?? null,
      });
      if (insertError) setError(insertError.message);
      else setComboClosures((prev) => [...prev, { combo_offer_id: combo.id, branch_id: selectedBranchId }]);
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
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th>الحالة</th>
                    <th>متاح في الفرع ده</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryItems.map((item) => {
                    const isClosed = closedItemIds.has(item.id);
                    return (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td className={isClosed ? "error-text" : "muted"}>{isClosed ? "مقفول في الفرع ده" : "متاح"}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={!isClosed}
                            disabled={busyKey === `${item.id}`}
                            onChange={() => toggleClosed(item, isClosed)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {combos.length > 0 && (
        <div className="card">
          <h2>{comboSectionLabel}</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الكومبو</th>
                  <th>الحالة</th>
                  <th>متاح في الفرع ده</th>
                </tr>
              </thead>
              <tbody>
                {combos.map((combo) => {
                  const isClosed = closedComboIds.has(combo.id);
                  return (
                    <tr key={combo.id}>
                      <td>{combo.name}</td>
                      <td className={isClosed ? "error-text" : "muted"}>{isClosed ? "مقفول في الفرع ده" : "متاح"}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!isClosed}
                          disabled={busyKey === `combo-${combo.id}`}
                          onChange={() => toggleComboClosed(combo, isClosed)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
