import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";
import { randomUUID } from "crypto";

interface OrderEvent {
  order_id: string;
  [key: string]: unknown;
}

export const handler = withDurableExecution(
  async (
    event: OrderEvent,
    context: DurableContext
  ): Promise<Record<string, unknown>> => {
    const orderId = event.order_id;
    context.logger.info("Order received", { order_id: orderId });

    // BUG: payment_id is generated outside a context.step().
    // On replay, randomUUID() produces a different value each time the handler
    // runs, so the value is NOT checkpointed and changes between replays.
    const paymentId = `PAY-${randomUUID().replace(/-/g, "").slice(0, 8)}`;

    const stepOneResult = await context.step("step-one", async () => {
      return { payment_id: paymentId };
    });

    context.logger.info("Step one complete", {
      payment_id: stepOneResult.payment_id,
    });

    // Suspend the execution. This ends the current invocation and forces a
    // REPLAY when it resumes: the handler runs again from the top, so
    // `paymentId` (generated outside a step) gets a brand-new value, while
    // `step-one` returns its OLD checkpointed value. That mismatch is what
    // surfaces the non-determinism bug in step-two below.
    await context.wait({ seconds: 5 });

    await context.step("step-two", async () => {

      context.logger.info("paymentId step 1:" + stepOneResult.payment_id);
      context.logger.info("paymentId step 2:" + paymentId)

      if (paymentId !== stepOneResult.payment_id) {
        throw new Error("Non-determinism detected - payment_id changed ");
      }
    });

    context.logger.info("Step two complete", { order_id: orderId });

    return { status: "completed", order_id: orderId };
  }
);
