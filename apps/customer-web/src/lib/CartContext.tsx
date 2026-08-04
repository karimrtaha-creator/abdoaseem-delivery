import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

export interface CartLine {
  key: string; // "item-<id>" or "combo-<id>" - stable across add/remove
  menu_item_id?: number;
  combo_offer_id?: number;
  name: string;
  unit_price: number;
  quantity: number;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  total: number;
  addLine: (line: Omit<CartLine, "quantity">) => void;
  changeQuantity: (key: string, delta: number) => void;
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

  function changeQuantity(key: string, delta: number) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0),
    );
  }

  const count = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines]);
  const total = useMemo(() => lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0), [lines]);

  return (
    <CartContext.Provider value={{ lines, count, total, addLine, changeQuantity }}>{children}</CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
