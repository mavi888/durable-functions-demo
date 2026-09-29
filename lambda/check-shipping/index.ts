interface Order {
  order_id: string;
  customer_id: string;
  total_amount: number;
  [key: string]: unknown;
}

interface ShippingResult {
  valid: boolean;
  reason?: string;
  estimated_days?: number;
}

export const handler = async (event: Order): Promise<ShippingResult> => {
  // TODO: replace with your real shipping-availability logic.
  if (!event.order_id) {
    return { valid: false, reason: "Missing order_id" };
  }

  // Simulate a shipping-availability check.
  return { valid: true, estimated_days: 3 };
};