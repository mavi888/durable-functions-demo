interface Order {
  order_id: string;
  customer_id: string;
  total_amount: number;
  [key: string]: unknown;
}

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export const handler = async (event: Order): Promise<ValidationResult> => {
  // TODO: replace with your real validation logic.
  if (!event.order_id || !event.customer_id) {
    return { valid: false, reason: "Missing order_id or customer_id" };
  }

  if (typeof event.total_amount !== "number" || event.total_amount <= 0) {
    return { valid: false, reason: "Invalid total_amount" };
  }

  return { valid: true };
};
