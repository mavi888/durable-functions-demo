import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const lambdaClient = new LambdaClient({});
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
 * Invokes another Lambda function synchronously and returns its parsed JSON payload.
 */
async function invokeLambda<T>(
  functionName: string,
  payload: unknown
): Promise<T> {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: InvocationType.RequestResponse,
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  if (response.FunctionError) {
    const errorPayload = response.Payload
      ? Buffer.from(response.Payload).toString("utf-8")
      : "unknown error";
    throw new Error(`Invocation of ${functionName} failed: ${errorPayload}`);
  }

  const raw = response.Payload
    ? Buffer.from(response.Payload).toString("utf-8")
    : "null";

  return JSON.parse(raw) as T;
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
        created_at: new Date().toISOString(),
      },
    })
  );
}

export const handler = async (
  event: Order
): Promise<Record<string, unknown>> => {
  const order = event;
  const orderId = order.order_id;

  // Step 1: Validate the order (calls order-validate Lambda)
  const validation = await invokeLambda<ValidationResult>(
    process.env.VALIDATE_ORDER_FUNCTION as string,
    order
  );

  if (!validation.valid) {
    return { status: "rejected", reason: validation.reason };
  }

  // Step 2: Process payment (calls order-process-payment Lambda)
  const payment = await invokeLambda<PaymentResult>(
    process.env.PROCESS_PAYMENT_FUNCTION as string,
    {
      order_id: order.order_id,
      amount: order.total_amount,
      customer_id: order.customer_id,
    }
  );

  // Step 3: Create order in database
  await createOrder(order, payment);

  return { status: "completed", order_id: orderId };
};
