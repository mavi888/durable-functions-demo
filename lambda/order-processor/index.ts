import {
  BatchResult,
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

interface PaymentResult {
  [key: string]: unknown;
}

/**
 * Persists the order in the DynamoDB orders table.
 */
async function createOrder(order: Order, payment: PaymentResult): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: process.env.ORDERS_TABLE_NAME as string,
      Item: {
        PK: `ORDER#${order.order_id}`,
        order_id: order.order_id,
        customer_id: order.customer_id,
        total_amount: order.total_amount,
        payment,
        status: "completed",
        // created_at is generated inside a step so its value is
        // checkpointed and stays stable across replays.
        created_at: new Date().toISOString(),
      },
    })
  );
}

export const handler = withDurableExecution(
  async (
    event: Order,
    context: DurableContext
  ): Promise<Record<string, unknown>> => {
    const order = event;
    const orderId = order.order_id;

    // Step 1: Validate the order in parallel - inventory and shipping
    // Each branch runs in its own child context and invokes a downstream
    // function through a durable, checkpointed invoke.

    const checkInventory = async (ctx: DurableContext) =>
      ctx.invoke<Order, ValidationResult>(
        "check-inventory",
        process.env.VALIDATE_ORDER_FUNCTION as string,
        order
      );

    const checkShipping = async (ctx: DurableContext) =>
      ctx.invoke<Order, ValidationResult>(
        "check-shipping",
        process.env.CHECK_SHIPPING_FUNCTION as string,
        order
      );

    const validationResults: BatchResult<ValidationResult> =
      await context.parallel("validate-order", [checkInventory, checkShipping]);

    const results = validationResults.getResults();
    const inventoryResult = results[0];
    const shippingResult = results[1];

    context.logger.info("Validation complete", {
      inventory_valid: inventoryResult?.valid,
      shipping_valid: shippingResult?.valid,
    });

    if (!inventoryResult?.valid) {
      return { status: "rejected", reason: "Item not in stock" };
    }

    if (!shippingResult?.valid) {
      return {
        status: "rejected",
        reason: shippingResult?.reason ?? "Shipping not available",
      };
    }

    // Step 2: Process payment (checkpointed durable invoke)
    const payment = await context.invoke<
      { order_id: string; amount: number; customer_id: string },
      PaymentResult
    >("process-payment", process.env.PROCESS_PAYMENT_FUNCTION as string, {
      order_id: order.order_id,
      amount: order.total_amount,
      customer_id: order.customer_id,
    });

    context.logger.info("Payment complete", { valid: payment.valid });


    // Step 3: Create order in database (checkpointed step)
    await context.step(
      "create-order",
      async () => createOrder(order, payment)
    );

    return { status: "completed", order_id: orderId };
  }
);
