# Invoke the function twice to get the order paid 2 times

aws lambda invoke \
  --function-name ldf-order-processor \
  --cli-binary-format raw-in-base64-out \
  --payload '{"order_id":"ORD-003","customer_id":"CUST-456","items":[{"item_id":"abc","quantity":1,"price":50}],"total_amount":50}' \
  response.json

# Invoke the Durable function 

aws lambda invoke \
  --function-name ldf-order-processor:live \
  --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --durable-execution-name order-ORD-001 \
  --payload '{"order_id":"ORD-001","customer_id":"CUST-456","items":[{"item_id":"abc","quantity":1,"price":50}],"total_amount":50}' \
  response.json 


# Invoke durable function with failure

aws lambda invoke \
  --function-name ldf-debug-replay:live \
  --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --durable-execution-name order-ORD-DEBUG-1 \
  --payload '{"order_id":"ORD-DEBUG-1"}' \
  response.json 