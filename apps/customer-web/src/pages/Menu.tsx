import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useCart } from "../lib/CartContext";
import { useAuth } from "../lib/AuthContext";

interface MenuCategory {
  id: number;
  category_id?: number;
  name: string;
  display_order: number;
}
interface MenuItem {
  id: number;
  category_id: number;
  name: string;
  price: number;
  is_available: boolean;
  image_url: string | null;
  description: string | null;
}
interface ComboChoiceOption {
  id: number;
  label: string;
  display_order: number;
}
interface ComboChoiceGroup {
  id: number;
  combo_offer_id: number;
  label: string;
  display_order: number;
  combo_choice_options: ComboChoiceOption[];
}
interface ComboOffer {
  id: number;
  name: string;
  description: string;
  price: number;
  is_active: boolean;
  image_url: string | null;
}
interface Closure {
  menu_item_id: number;
  branch_id: number;
}
interface ExtraApplicability {
  extra_item_id: number;
  applies_to_item_id: number;
}

// Upsell suggestions shown under specific base items - a suggestion, not a
// restriction (that's a separate mechanism, menu_item_extra_applicability).
// Keyed by base item name since ids are stable but names read clearer here
// and this table is tiny/hand-authored either way.
const UPSELL_SUGGESTIONS: Record<string, string[]> = {
  "طاجن فراخ": ["إضافة فراخ", "طاجن فراخ موتزريلا"],
  "طاجن لحم": ["إضافة لحمة", "طاجن لحمة موتزريلا"],
};

export function Menu() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [combos, setCombos] = useState<ComboOffer[]>([]);
  const [comboChoiceGroups, setComboChoiceGroups] = useState<ComboChoiceGroup[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [extraApplicability, setExtraApplicability] = useState<ExtraApplicability[]>([]);
  const [nearestBranch, setNearestBranch] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  // combo_offer_id -> choice_group_id -> selected option id
  const [comboSelections, setComboSelections] = useState<Record<number, Record<number, number>>>({});
  const cart = useCart();
  const { profile, session, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      supabase.from("menu_categories").select("id, name, display_order").order("display_order"),
      supabase
        .from("menu_items")
        .select("id, category_id, name, price, is_available, image_url, description")
        .eq("is_available", true),
      supabase.from("combo_offers").select("id, name, description, price, is_active, image_url").eq("is_active", true),
      supabase
        .from("combo_choice_groups")
        .select("id, combo_offer_id, label, display_order, combo_choice_options(id, label, display_order)")
        .order("display_order"),
      supabase.from("menu_item_branch_closures").select("menu_item_id, branch_id"),
      supabase.from("menu_item_extra_applicability").select("extra_item_id, applies_to_item_id"),
    ]).then(([categoriesRes, itemsRes, combosRes, choiceGroupsRes, closuresRes, extrasRes]) => {
      setCategories((categoriesRes.data as MenuCategory[]) ?? []);
      setItems((itemsRes.data as MenuItem[]) ?? []);
      setCombos((combosRes.data as ComboOffer[]) ?? []);
      // All of these fail-open (empty array) if their migration hasn't
      // been applied live yet - that just means no closures/restrictions/
      // choice-groups are known, which matches today's behaviour, not a
      // regression.
      setComboChoiceGroups((choiceGroupsRes.data as ComboChoiceGroup[]) ?? []);
      setClosures((closuresRes.data as Closure[]) ?? []);
      setExtraApplicability((extrasRes.data as ExtraApplicability[]) ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!session) {
      setNearestBranch(null);
      return;
    }
    supabase
      .from("customer_addresses")
      .select("nearest_branch_id, branches(id, name, is_delivery_available, delivery_fallback_branch_id)")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(async ({ data }) => {
        const row = data as {
          nearest_branch_id: number | null;
          branches: { id: number; name: string; is_delivery_available: boolean; delivery_fallback_branch_id: number | null } | null;
        } | null;
        const branch = row?.branches;
        if (!branch) {
          setNearestBranch(null);
          return;
        }
        // Some branches are dine-in/takeaway only but still route their
        // deliveries to a sister branch (delivery_fallback_branch_id) -
        // show the branch that will actually fulfil the order, not the
        // raw nearest one, so "بيتوصلك من فرع" and the closure checks
        // below match what checkout will actually do.
        if (branch.is_delivery_available) {
          setNearestBranch({ id: branch.id, name: branch.name });
          return;
        }
        if (!branch.delivery_fallback_branch_id) {
          setNearestBranch(null);
          return;
        }
        const { data: fallback } = await supabase
          .from("branches")
          .select("id, name")
          .eq("id", branch.delivery_fallback_branch_id)
          .maybeSingle();
        setNearestBranch(fallback ?? null);
      });
    // customer_addresses may not exist live yet (see [[project_migration_state]])
    // - the query above resolves with an error and null data in that case,
    // which the ?. above turns into "no branch known", same fail-open story.
  }, [session]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<number, MenuItem[]>();
    for (const item of items) {
      const list = map.get(item.category_id) ?? [];
      list.push(item);
      map.set(item.category_id, list);
    }
    return map;
  }, [items]);

  const itemsByName = useMemo(() => new Map(items.map((i) => [i.name, i])), [items]);

  // Talabat-style tab bar: one tab per non-empty section (combos + each
  // category that actually has items), selecting a tab shows only that
  // section instead of one long scroll.
  const sections = useMemo(() => {
    const list: { key: string; label: string }[] = [];
    if (combos.length > 0) list.push({ key: "combos", label: "الكومبوهات" });
    for (const category of categories) {
      if ((itemsByCategory.get(category.id) ?? []).length > 0) {
        list.push({ key: `cat-${category.id}`, label: category.name });
      }
    }
    return list;
  }, [combos, categories, itemsByCategory]);

  useEffect(() => {
    if (sections.length > 0 && (!activeSection || !sections.some((s) => s.key === activeSection))) {
      setActiveSection(sections[0].key);
    }
  }, [sections, activeSection]);

  const choiceGroupsByCombo = useMemo(() => {
    const map = new Map<number, ComboChoiceGroup[]>();
    for (const group of comboChoiceGroups) {
      const list = map.get(group.combo_offer_id) ?? [];
      list.push(group);
      map.set(group.combo_offer_id, list);
    }
    return map;
  }, [comboChoiceGroups]);

  const closedAtMyBranch = useMemo(() => {
    if (!nearestBranch) return new Set<number>();
    return new Set(closures.filter((c) => c.branch_id === nearestBranch.id).map((c) => c.menu_item_id));
  }, [closures, nearestBranch]);

  // extra_item_id -> set of base item ids it's restricted to (absent from
  // this map at all = unrestricted, addable regardless of cart contents)
  const restrictionsByExtra = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const row of extraApplicability) {
      const set = map.get(row.extra_item_id) ?? new Set<number>();
      set.add(row.applies_to_item_id);
      map.set(row.extra_item_id, set);
    }
    return map;
  }, [extraApplicability]);

  const cartHasBaseItem = useMemo(() => {
    const ids = new Set<number>();
    for (const line of cart.lines) {
      if (line.menu_item_id) ids.add(line.menu_item_id);
    }
    return ids;
  }, [cart.lines]);

  function quantityOf(key: string) {
    return cart.lines.find((l) => l.key === key)?.quantity ?? 0;
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  function handleAdd(item: MenuItem) {
    if (nearestBranch && closedAtMyBranch.has(item.id)) {
      showToast(`المنتج ده مش متوفر دلوقتي في فرع ${nearestBranch.name}`);
      return;
    }
    const restriction = restrictionsByExtra.get(item.id);
    if (restriction && ![...restriction].some((id) => cartHasBaseItem.has(id))) {
      showToast("الإضافة دي متاحة بس مع الطواجن الوسط (فراخ / لحم / خضار)");
      return;
    }
    cart.addLine({ key: `item-${item.id}`, menu_item_id: item.id, name: item.name, unit_price: item.price });
  }

  function selectComboOption(comboId: number, groupId: number, optionId: number) {
    setComboSelections((prev) => ({ ...prev, [comboId]: { ...prev[comboId], [groupId]: optionId } }));
  }

  function handleAddCombo(combo: ComboOffer) {
    const groups = choiceGroupsByCombo.get(combo.id) ?? [];
    const selection = comboSelections[combo.id] ?? {};
    const missing = groups.some((g) => !selection[g.id]);
    if (missing) {
      showToast("اختار كل الخيارات الأول");
      return;
    }
    const optionIds = groups.map((g) => selection[g.id]);
    const labels = groups.map((g) => g.combo_choice_options.find((o) => o.id === selection[g.id])?.label ?? "");
    const key = optionIds.length > 0 ? `combo-${combo.id}-${optionIds.join("-")}` : `combo-${combo.id}`;
    cart.addLine({
      key,
      combo_offer_id: combo.id,
      name: combo.name,
      unit_price: combo.price,
      comboChoiceOptionIds: optionIds.length > 0 ? optionIds : undefined,
      comboChoiceLabels: labels.length > 0 ? labels : undefined,
    });
  }

  if (loading) return <p className="muted centered-page">جاري تحميل المنيو...</p>;

  return (
    <div style={{ paddingBottom: cart.count > 0 ? "88px" : "0" }}>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" style={{ textDecoration: "none" }}>
            كشري الغباشي
          </Link>
          {profile ? (
            <div className="user-chip">
              <span>أهلاً {profile.name || "بيك"}</span>
              <button className="btn-link" onClick={() => navigate("/orders")}>
                طلباتي
              </button>
              <button className="btn-link" onClick={() => navigate("/addresses")}>
                عناويني
              </button>
              <button className="btn-link" onClick={() => navigate("/settings")}>
                بياناتي
              </button>
              <button className="btn btn-ghost" onClick={() => signOut()}>
                خروج
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost" onClick={() => navigate("/login")}>
              تسجيل الدخول
            </button>
          )}
        </div>
      </header>

      <div className="wrap">
        <h1 style={{ marginTop: "var(--space-4)" }}>المنيو</h1>
        {nearestBranch && <p className="muted">بيتوصلك من فرع {nearestBranch.name}</p>}

        {sections.length > 1 && (
          <nav className="menu-tabs">
            {sections.map((s) => (
              <button
                key={s.key}
                className={`menu-tab${s.key === activeSection ? " menu-tab-active" : ""}`}
                onClick={() => setActiveSection(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )}

        {activeSection === "combos" && combos.length > 0 && (
          <section className="section" style={{ paddingBlock: "var(--space-4)" }}>
            <h2 className="section-title">الكومبوهات</h2>
            <div className="photo-grid">
              {combos.map((combo) => {
                const groups = choiceGroupsByCombo.get(combo.id) ?? [];
                const selection = comboSelections[combo.id] ?? {};
                const optionIds = groups.map((g) => selection[g.id]).filter(Boolean);
                const key = groups.length > 0 ? `combo-${combo.id}-${optionIds.join("-")}` : `combo-${combo.id}`;
                const qty = quantityOf(key);
                return (
                  <div key={combo.id} className="photo-card">
                    {combo.image_url ? (
                      <img src={combo.image_url} alt={combo.name} className="photo-card-image" />
                    ) : (
                      <div className="photo-card-image placeholder-image" />
                    )}
                    <div className="photo-card-body">
                      <h3>{combo.name}</h3>
                      <p className="muted">{combo.description}</p>

                      {groups.map((group) => (
                        <div key={group.id} className="combo-choice-group">
                          <p className="combo-choice-label">{group.label}</p>
                          <div className="combo-choice-options">
                            {group.combo_choice_options.map((option) => (
                              <label key={option.id} className="combo-choice-option">
                                <input
                                  type="radio"
                                  name={`combo-${combo.id}-group-${group.id}`}
                                  checked={selection[group.id] === option.id}
                                  onChange={() => selectComboOption(combo.id, group.id, option.id)}
                                />
                                {option.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}

                      <div className="photo-card-footer">
                        <span className="menu-card-price">{combo.price} ج</span>
                        <button className="btn btn-primary" onClick={() => handleAddCombo(combo)}>
                          {qty > 0 ? `أضف كمان (${qty})` : "أضف للسلة"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {categories.map((category) => {
          const categoryItems = itemsByCategory.get(category.id) ?? [];
          if (categoryItems.length === 0) return null;
          if (activeSection !== `cat-${category.id}`) return null;
          return (
            <section key={category.id} className="section" style={{ paddingBlock: "var(--space-4)" }}>
              <h2 className="section-title">{category.name}</h2>
              <div className="photo-grid">
                {categoryItems.map((item) => {
                  const key = `item-${item.id}`;
                  const qty = quantityOf(key);
                  const isClosed = nearestBranch !== null && closedAtMyBranch.has(item.id);
                  const restriction = restrictionsByExtra.get(item.id);
                  const isRestricted = restriction !== undefined && ![...restriction].some((id) => cartHasBaseItem.has(id));
                  const suggestionNames = UPSELL_SUGGESTIONS[item.name];
                  return (
                    <div key={item.id} className="photo-card">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="photo-card-image" />
                      ) : (
                        <div className="photo-card-image placeholder-image" />
                      )}
                      <div className="photo-card-body">
                        <h3>{item.name}</h3>
                        {item.description && <p className="muted photo-card-desc">{item.description}</p>}
                        {isClosed && <p className="error-text">مش متوفر في فرع {nearestBranch?.name}</p>}
                        {!isClosed && isRestricted && <p className="muted photo-card-hint">متاحة بس مع الطواجن الوسط</p>}
                        <div className="photo-card-footer">
                          <span className="menu-card-price">{item.price} ج</span>
                          <button className="btn btn-primary" disabled={isClosed} onClick={() => handleAdd(item)}>
                            {qty > 0 ? `أضف كمان (${qty})` : "أضف للسلة"}
                          </button>
                        </div>
                        {suggestionNames && (
                          <p className="upsell-suggestion">
                            كمان يعجبك:{" "}
                            {suggestionNames
                              .map((n) => itemsByName.get(n))
                              .filter((i): i is MenuItem => !!i)
                              .map((i) => i.name)
                              .join(" أو ")}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {toast && <div className="toast">{toast}</div>}

      {cart.count > 0 && (
        <div className="cart-bar">
          <div className="wrap cart-bar-inner">
            <span>
              {cart.count} صنف - <strong>{cart.total} ج</strong>
              <span className="cart-bar-note">(السعر ده مش شامل رسوم التوصيل)</span>
            </span>
            <button className="btn btn-primary btn-lg" onClick={() => navigate("/checkout")}>
              استكمال الطلب
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
