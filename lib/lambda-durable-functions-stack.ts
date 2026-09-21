import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

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
      logGroup: new logs.LogGroup(this, 'ValidateOrderLogGroup', {
        logGroupName: `/aws/lambda/${prefix}-order-validate`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Alias for validate-order. Durable invokes require a qualified ARN
    // (version or alias), so downstream functions are invoked through an alias.
    const validateOrderAlias = new lambda.Alias(this, 'ValidateOrderAlias', {
      aliasName: 'live',
      version: validateOrderFn.currentVersion,
    });

    // Lambda that processes the payment.
    const processPaymentFn = new NodejsFunction(this, 'ProcessPaymentFunction', {
      ...commonProps,
      functionName: `${prefix}-order-process-payment`,
      entry: path.join(__dirname, '..', 'lambda', 'process-payment', 'index.ts'),
      environment: {
        PAYMENTS_TABLE_NAME: paymentsTable.tableName,
      },
      logGroup: new logs.LogGroup(this, 'ProcessPaymentLogGroup', {
        logGroupName: `/aws/lambda/${prefix}-order-process-payment`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Alias for process-payment (qualified ARN for durable invoke).
    const processPaymentAlias = new lambda.Alias(this, 'ProcessPaymentAlias', {
      aliasName: 'live',
      version: processPaymentFn.currentVersion,
    });

    // Allow the payment function to write payments to DynamoDB.
    paymentsTable.grantWriteData(processPaymentFn);

    // Main orchestrator Lambda, configured as a durable function.
    const orderProcessorFn = new NodejsFunction(this, 'OrderProcessorFunction', {
      ...commonProps,
      functionName: `${prefix}-order-processor`,
      entry: path.join(__dirname, '..', 'lambda', 'order-processor', 'index.ts'),
      durableConfig: {
        executionTimeout: cdk.Duration.hours(1),
        retentionPeriod: cdk.Duration.days(7),
      },
      environment: {
        // Pass qualified alias ARNs so the durable invokes target a version/alias.
        VALIDATE_ORDER_FUNCTION: validateOrderAlias.functionArn,
        PROCESS_PAYMENT_FUNCTION: processPaymentAlias.functionArn,
        ORDERS_TABLE_NAME: ordersTable.tableName,
      },
      logGroup: new logs.LogGroup(this, 'OrderProcessorLogGroup', {
        logGroupName: `/aws/lambda/${prefix}-order-processor`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Grant the checkpoint permissions required for durable execution.
    orderProcessorFn.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AWSLambdaBasicDurableExecutionRolePolicy',
      ),
    );

    // Allow the orchestrator to invoke the downstream functions via their aliases.
    validateOrderAlias.grantInvoke(orderProcessorFn);
    processPaymentAlias.grantInvoke(orderProcessorFn);

    // Allow the orchestrator to write orders to DynamoDB.
    ordersTable.grantWriteData(orderProcessorFn);

    // Alias for the orchestrator itself. Durable functions must be invoked
    // through a qualified ARN, so invoke this alias (not the bare function).
    const orderProcessorAlias = new lambda.Alias(this, 'OrderProcessorAlias', {
      aliasName: 'live',
      version: orderProcessorFn.currentVersion,
    });

    // OUTPUTS ---------------------------------------------------
    new cdk.CfnOutput(this, 'OrderProcessorFunctionName', {
      value: orderProcessorFn.functionName,
    });

    new cdk.CfnOutput(this, 'OrderProcessorAliasArn', {
      value: orderProcessorAlias.functionArn,
      description: 'Qualified ARN to invoke the durable order processor',
    });
  }
}
