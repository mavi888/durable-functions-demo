import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface PaymentRequest {
  order_id: string;
  amount: number;
  customer_id: string;
}

interface PaymentResult {
  payment_id: string;
  status: string;
  amount: number;
}

export const handler = async (
  event: PaymentRequest
): Promise<PaymentResult> => {
  // TODO: replace with your real payment processing logic.
  const paymentId = `PAY-${randomUUID().slice(0, 8)}`;

  const payment: PaymentResult = {
    payment_id: paymentId,
    status: "paid",
    amount: event.amount,
  };

  // Store the payment as a row in the payments table.
  await docClient.send(
    new PutCommand({
      TableName: process.env.PAYMENTS_TABLE_NAME as string,
      Item: {
        PK: `PAY#${paymentId}`,
        payment_id: paymentId,
        order_id: event.order_id,
        customer_id: event.customer_id,
        amount: event.amount,
        status: payment.status,
        created_at: new Date().toISOString(),
      },
    })
  );

  return payment;
};
