import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

// Extends the standard stack props with a common prefix applied to all
// resource names, so it can be defined in a single place (see bin/).
export interface LambdaDurableFunctionsStackProps extends cdk.StackProps {
  resourcePrefix: string;
}

export class LambdaDurableFunctionsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LambdaDurableFunctionsStackProps) {
    super(scope, id, props);

    // Common prefix applied to every resource name.
    const prefix = props.resourcePrefix;

    // DYNAMODB TABLES ----------------------------------------

    // DynamoDB table where processed orders are stored.
    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: `${prefix}-orders`,
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB table where payments are stored.
    const paymentsTable = new dynamodb.Table(this, 'PaymentsTable', {
      tableName: `${prefix}-payments`,
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });


    // LAMBDA FUNCTIONS --------------------------------------

    const commonProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
    };

    // Lambda that validates the incoming order.
    const validateOrderFn = new NodejsFunction(this, 'ValidateOrderFunction', {
      ...commonProps,
      functionName: `${prefix}-order-validate`,
      entry: path.join(__dirname, '..', 'lambda', 'validate-order', 'index.ts'),
    });

    // Lambda that processes the payment.
    const processPaymentFn = new NodejsFunction(this, 'ProcessPaymentFunction', {
      ...commonProps,
      functionName: `${prefix}-order-process-payment`,
      entry: path.join(__dirname, '..', 'lambda', 'process-payment', 'index.ts'),
      environment: {
        PAYMENTS_TABLE_NAME: paymentsTable.tableName,
      },
    });

    // Allow the payment function to write payments to DynamoDB.
    paymentsTable.grantWriteData(processPaymentFn);

    // Main orchestrator Lambda function that invokes the other two functions.
    const orderProcessorFn = new NodejsFunction(this, 'OrderProcessorFunction', {
      ...commonProps,
      functionName: `${prefix}-order-processor`,
      entry: path.join(__dirname, '..', 'lambda', 'order-processor', 'index.ts'),
      environment: {
        VALIDATE_ORDER_FUNCTION: validateOrderFn.functionName,
        PROCESS_PAYMENT_FUNCTION: processPaymentFn.functionName,
        ORDERS_TABLE_NAME: ordersTable.tableName,
      },
    });

    // Allow the orchestrator to invoke the downstream functions.
    validateOrderFn.grantInvoke(orderProcessorFn);
    processPaymentFn.grantInvoke(orderProcessorFn);

    // Allow the orchestrator to write orders to DynamoDB.
    ordersTable.grantWriteData(orderProcessorFn);

    new cdk.CfnOutput(this, 'OrderProcessorFunctionName', {
      value: orderProcessorFn.functionName,
    });
  }
}
