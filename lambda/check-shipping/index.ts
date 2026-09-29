interface OrderItem {
  item_id?: string;
  quantity?: number;
  price?: number;
  [key: string]: unknown;
}

interface Order {
  order_id: string;
  customer_id: string;
  total_amount: number;
  items?: OrderItem[];
  // Optional override for local testing: force a specific shipping estimate.
  estimated_shipping_days?: number;
  [key: string]: unknown;
}

interface ShippingResult {
  valid: boolean;
  reason?: string;
  estimated_days?: number;
  shippable_within_30_days: boolean;
}

export const handler = async (event: Order): Promise<ShippingResult> => {
  // TODO: replace with your real shipping-availability logic.
  if (!event.order_id) {
    return {
      valid: false,
      reason: "Missing order_id",
      shippable_within_30_days: false,
    };
  }

  // Simulate a shipping-availability check.
  //
  // For testing the human-in-the-loop flow you can drive the estimate from the
  // payload in two ways:
  //   1. Set `estimated_shipping_days` explicitly (e.g. 45).
  //   2. Include an item whose id contains "BACKORDER", which simulates stock
  //      that ships in more than 30 days.
  const hasBackorderItem = (event.items ?? []).some((item) =>
    String(item.item_id ?? "").toUpperCase().includes("BACKORDER")
  );

  const estimatedDays =
    typeof event.estimated_shipping_days === "number"
      ? event.estimated_shipping_days
      : hasBackorderItem
        ? 45
        : 3;

  return {
    valid: true,
    estimated_days: estimatedDays,
    shippable_within_30_days: estimatedDays <= 30,
  };
};
