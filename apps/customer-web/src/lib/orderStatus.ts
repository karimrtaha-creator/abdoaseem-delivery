export type OrderStatus =
  | "pending_acceptance"
  | "preparing"
  | "out_for_delivery"
  | "delivered"
  | "delayed"
  | "cancelled"
  | "rejected";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_acceptance: "بانتظار قبول الفرع",
  preparing: "بيتحضّر",
  out_for_delivery: "في الطريق ليك",
  delivered: "وصل",
  delayed: "متأخر شوية",
  cancelled: "اتلغى",
  rejected: "الفرع اعتذر عن الطلب",
};

// Ordered progress steps for the visual tracker - cancelled/rejected are
// terminal-but-not-on-the-happy-path so they're handled separately in the
// component rather than placed on this line.
export const ORDER_STATUS_STEPS: OrderStatus[] = ["pending_acceptance", "preparing", "out_for_delivery", "delivered"];
