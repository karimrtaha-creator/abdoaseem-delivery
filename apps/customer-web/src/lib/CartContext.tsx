import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

// "اصنع وجبتك بنفسك" box builder (2026-09-10) - a built box's fills are
// free (covered by the box size's price, up to capacityGrams), extras are
// each priced on their own. This shape is display-only, same spirit as
// comboChoiceLabels: create-order re-resolves grams/prices server-side
// from box_size_id/fills/extras' ids and never trusts unit_price or these
// labels/quantities as sent.
export interface BuiltBoxFill {
  menu_item_id: number;
  name: string;
  grams_per_unit: number;
  quantity: number;
}
export interface BuiltBoxExtra {
  menu_item_id: number;
  name: string;
  price: number;
  quantity: number;
}
export interface BuiltBox {
  box_size_id: number;
  categoryName: string;
  sizeName: string;
  capacityGrams: number;
  fills: BuiltBoxFill[];
  extras: BuiltBoxExtra[];
}

export interface CartLine {
  key: string; // "item-<id>" or "combo-<id>-<choiceOptionIds>" - stable across add/remove
  menu_item_id?: number;
  combo_offer_id?: number;
  builtBox?: BuiltBox;
  name: string;
  unit_price: number;
  quantity: number;
  // Chosen option per combo_choice_group, in group display_order - only
  // set for combo lines with choice groups. create-order re-resolves
  // these server-side (never trusts the label text itself), this is just
  // what the cart/checkout UI displays before submitting.
  comboChoiceOptionIds?: number[];
  comboChoiceLabels?: string[];
  // Free-text note on this specific line ("من غير تقلية" etc.) - set at
  // checkout, never interpreted client-side, just relayed to create-order.
  note?: string;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  total: number;
  addLine: (line: Omit<CartLine, "quantity">) => void;
  addBuiltBox: (params: { box_size_id: number; price: number; categoryName: string; sizeName: string; capacityGrams: number; fills: BuiltBoxFill[]; extras: BuiltBoxExtra[] }) => void;
  changeQuantity: (key: string, delta: number) => void;
  setNote: (key: string, note: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "abdoaseem-cart-v1";

function loadInitial(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  function addLine(line: Omit<CartLine, "quantity">) {
    setLines((prev) => {
      const existing = prev.find((l) => l.key === line.key);
      if (existing) {
        return prev.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { ...line, quantity: 1 }];
    });
  }

  // Same merge-by-key shape addLine already uses for combos: identical
  // builds (same size + same fills + same extras) merge into one line's
  // quantity, a different build gets its own line.
  function addBuiltBox(params: { box_size_id: number; price: number; categoryName: string; sizeName: string; capacityGrams: number; fills: BuiltBoxFill[]; extras: BuiltBoxExtra[] }) {
    const extrasTotal = params.extras.reduce((sum, e) => sum + e.price * e.quantity, 0);
    const fillsKey = params.fills.map((f) => `${f.menu_item_id}x${f.quantity}`).sort().join(",");
    const extrasKey = params.extras.map((e) => `${e.menu_item_id}x${e.quantity}`).sort().join(",");
    addLine({
      key: `box-${params.box_size_id}-${fillsKey}-${extrasKey}`,
      name: `${params.categoryName} - ${params.sizeName}`,
      unit_price: params.price + extrasTotal,
      builtBox: {
        box_size_id: params.box_size_id,
        categoryName: params.categoryName,
        sizeName: params.sizeName,
        capacityGrams: params.capacityGrams,
        fills: params.fills,
        extras: params.extras,
      },
    });
  }

  function changeQuantity(key: string, delta: number) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0),
    );
  }

  function setNote(key: string, note: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, note } : l)));
  }

  function clear() {
    setLines([]);
  }

  const count = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines]);
  const total = useMemo(() => lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0), [lines]);

  return (
    <CartContext.Provider value={{ lines, count, total, addLine, addBuiltBox, changeQuantity, setNote, clear }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
