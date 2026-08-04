import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

interface ComboOffer {
  id: number;
  name: string;
  description: string;
  price: number;
}

const APPEAR_DELAY_MS = 1500;
const ROTATE_MS = 5000;

/**
 * The signature automated element: surfaces today's combo offers on its
 * own, shortly after the page loads, for anyone who hasn't started an
 * order yet - the moment the customer opens the site, before they've
 * decided what to eat, is exactly when a nudge toward a combo is useful
 * rather than annoying. The instant they act on an order (hasStartedOrder
 * flips true), it steps back to a small reopenable pill instead of
 * fighting for attention over the thing they're actually doing.
 */
export function OffersRibbon({ hasStartedOrder }: { hasStartedOrder: boolean }) {
  const [offers, setOffers] = useState<ComboOffer[]>([]);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    supabase
      .from("combo_offers")
      .select("id, name, description, price")
      .eq("is_active", true)
      .then(({ data }) => setOffers((data as ComboOffer[]) ?? []));
  }, []);

  useEffect(() => {
    if (offers.length === 0) return;
    const timer = setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [offers.length]);

  useEffect(() => {
    if (!visible || offers.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % offers.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [visible, offers.length]);

  if (offers.length === 0 || dismissed) return null;

  const collapsed = hasStartedOrder;

  if (collapsed) {
    return (
      <div className="offers-ribbon">
        <button className="offers-pill" onClick={() => setDismissed(true)} aria-label="اقفل العروض">
          🔥 عروض اليوم
        </button>
      </div>
    );
  }

  if (!visible) return null;

  const offer = offers[index];

  return (
    <div className="offers-ribbon">
      <div className="offers-card" role="status" aria-live="polite">
        <button className="offers-close" onClick={() => setDismissed(true)} aria-label="اقفل">
          ✕
        </button>
        <span className="offers-nudge">🔥 شوف عروض النهاردة</span>
        <div className="offers-detail">
          <span className="text">{offer.name}</span>
          <span className="price">{offer.price} ج</span>
        </div>
      </div>
    </div>
  );
}
